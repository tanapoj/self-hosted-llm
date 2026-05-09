import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Ollama from "ollama";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// เสิร์ฟไฟล์ Frontend จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const INPUTS_DIR = path.join(__dirname, "inputs"); 

const MODELS = {
  thai25: "scb10x/typhoon2.5-qwen3-4b",
  thai21: "scb10x/typhoon2.1-gemma3-12b",
  general32: "qwen3:32b",
  general12: "gemma3:12b",
};

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยนักเขียนภาษาไทย ช่วยในด้าน:
- คิดไอเดียและพัฒนาโครงเรื่อง
- ขยายเนื้อหาและแต่งบทความ
- ตรวจคำผิดและแนะนำการปรับปรุง
ตอบเป็นภาษาไทยเสมอ ยกเว้นถูกขอให้ตอบภาษาอื่น`;

// ตรวจสอบและสร้างโฟลเดอร์ data และ inputs
async function initDirs() {
  try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR); }
  try { await fs.access(INPUTS_DIR); } catch { await fs.mkdir(INPUTS_DIR); }
}
initDirs();

// ฟังก์ชันสำหรับอ่านทุกไฟล์ในโฟลเดอร์ inputs
async function readInputFiles() {
  let combinedInputs = "";
  try {
    const files = await fs.readdir(INPUTS_DIR);
    for (const file of files) {
      const filePath = path.join(INPUTS_DIR, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isFile() && !file.startsWith('.')) {
        try {
          const content = await fs.readFile(filePath, "utf-8");
          combinedInputs += `\n\n--- เริ่มเนื้อหาจากไฟล์: ${file} ---\n`;
          combinedInputs += content;
          combinedInputs += `\n--- จบเนื้อหาจากไฟล์: ${file} ---\n`;
        } catch (readErr) {
          console.error(`ไม่สามารถอ่านไฟล์ ${file} ได้:`, readErr.message);
        }
      }
    }
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการเข้าถึงโฟลเดอร์ inputs:", error.message);
  }
  return combinedInputs;
}

// API: ดึงรายชื่อแชททั้งหมด
app.get("/api/chats", async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const chats = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
        const data = JSON.parse(content);
        chats.push({
          id: data.id,
          title: data.title || "Chat ใหม่",
          updatedAt: data.updatedAt,
        });
      }
    }
    chats.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: สร้างแชทใหม่
app.post("/api/chats", async (req, res) => {
  const id = Date.now().toString();
  const newChat = {
    id,
    title: "ห้องสนทนาใหม่",
    updatedAt: Date.now(),
    messages: [],
  };
  await fs.writeFile(path.join(DATA_DIR, `${id}.json`), JSON.stringify(newChat, null, 2));
  res.json(newChat);
});

// API: ดึงข้อมูลแชทตาม ID
app.get("/api/chats/:id", async (req, res) => {
  try {
    const content = await fs.readFile(path.join(DATA_DIR, `${req.params.id}.json`), "utf-8");
    res.json(JSON.parse(content));
  } catch (error) {
    res.status(404).json({ error: "ไม่พบข้อมูลแชท" });
  }
});

// API: เปลี่ยนชื่อแชท
app.put("/api/chats/:id/title", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "ต้องระบุชื่อแชท" });

    const filePath = path.join(DATA_DIR, `${req.params.id}.json`);
    const chatData = JSON.parse(await fs.readFile(filePath, "utf-8"));
    
    chatData.title = title;
    chatData.updatedAt = Date.now();
    await fs.writeFile(filePath, JSON.stringify(chatData, null, 2));

    res.json(chatData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: ส่งข้อความและรับ Stream จาก Ollama
app.post("/api/chats/:id/message", async (req, res) => {
  // รับค่า historyLimit มาด้วย
  const { id } = req.params;
  const { message, model = "thai25", systemPrompt, historyLimit = 20 } = req.body;

  try {
    const filePath = path.join(DATA_DIR, `${id}.json`);
    const chatData = JSON.parse(await fs.readFile(filePath, "utf-8"));

    // ตั้งชื่อแชทจากข้อความแรก
    if (chatData.messages.length === 0) {
      chatData.title = message.substring(0, 30) + (message.length > 30 ? "..." : "");
    }

    // เพิ่มข้อความผู้ใช้
    chatData.messages.push({ role: "user", content: message });
    chatData.updatedAt = Date.now();
    await fs.writeFile(filePath, JSON.stringify(chatData, null, 2)); 

    // กวาดไฟล์จาก /inputs
    const filesContent = await readInputFiles();
    
    let finalSystemPrompt = systemPrompt || SYSTEM_PROMPT;
    if (filesContent.trim() !== "") {
      finalSystemPrompt += `\n\nนี่คือข้อมูลอ้างอิงหรือบริบทเพิ่มเติมที่คุณต้องรับรู้:\n${filesContent}`;
    }

    // --- จัดการจำกัด History ก่อนส่งให้ LLM ---
    let contextMessages = chatData.messages;
    const limit = parseInt(historyLimit, 10) + 1;
    // ถ้า limit มากกว่า 0 ให้ตัดอาร์เรย์เอาเฉพาะ N ตัวล่าสุด
    console.log('fetch history limit:', limit)
    if (!isNaN(limit) && limit > 0) {
      contextMessages = chatData.messages.slice(-limit);
    }

    const ollamaMessages = [
      { role: "system", content: finalSystemPrompt },
      ...contextMessages.map(m => ({ role: m.role, content: m.content }))
    ];

    // ตั้งค่า Header สำหรับ Streaming กลับไปที่ Frontend
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    console.log('call Ollama chat')
    const response = await Ollama.chat({
      model: MODELS[model],
      messages: ollamaMessages,
      stream: true,
    });

    let assistantFullResponse = "";

    for await (const part of response) {
      const text = part.message.content;
      assistantFullResponse += text;
      res.write(text); // ส่งข้อมูลก้อนย่อยๆ กลับไปทันที
    }

    res.end();

    // บันทึกคำตอบของ Assistant ลงไฟล์
    chatData.messages.push({ role: "assistant", content: assistantFullResponse });
    await fs.writeFile(filePath, JSON.stringify(chatData, null, 2));

  } catch (error) {
    console.error("Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.end(`\n\n[เกิดข้อผิดพลาด: ${error.message}]`);
    }
  }
});

// ให้ Route อื่นๆ (ที่ไม่ใช่ API) โยนกลับไปที่ index.html (สำหรับ React SPA)
// รองรับ Express v5 ด้วยการใช้ Regex /.*/ แทน "*"
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next(); // ถ้าเป็น API แล้วหาไม่เจอ ให้ข้ามไป (จะได้ 404 แทนที่จะได้ไฟล์ HTML)
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server runs at http://localhost:${PORT}`);
});
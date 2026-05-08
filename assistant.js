import Ollama from "ollama";

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

async function chat(prompt, model = "thai25", stream = true) {
  const response = await Ollama.chat({
    model: MODELS[model],
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    stream,
  });

  if (stream) {
    for await (const part of response) {
      process.stdout.write(part.message.content);
    }
    console.log();
  } else {
    return response.message.content;
  }
}

// ตัวอย่างการใช้งาน
const task = process.argv[2];
const input = process.argv[3];

if (task === "proofread") {
  await chat(`ตรวจคำผิดและแนะนำการแก้ไขข้อความนี้:\n\n${input}`);
} else if (task === "expand") {
  await chat(`ขยายเนื้อหาย่อหน้านี้ให้ละเอียดและสละสลวยขึ้น:\n\n${input}`);
} else if (task === "idea") {
  await chat(`ช่วยคิดไอเดียสำหรับ: ${input}`);
}
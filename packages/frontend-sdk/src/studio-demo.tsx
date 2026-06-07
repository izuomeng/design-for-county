// Studio demo entry — mounts the two-pane 寻美 packaging-design studio.
import OceanMCPSDK from "./main";

const API = "http://localhost:4001";

// Product-photo upload — adds a 📎 upload button to the chat input. Uploaded
// files are stored on the api-server and returned as public URLs that the
// agent can pass to generateImage as referenceImageUrls (image-to-image).
OceanMCPSDK.registerUploader(async (files) => {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${API}/api/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.files as { url: string; name: string; size?: number; type?: string }[];
});

OceanMCPSDK.mount({
  root: "ocean-mcp-root",
  studio: true,
  locale: "zh-CN",
  welcomeLogo: "/logo.png",
  welcomeTitle: "寻美 · AI 包装小助手",
  welcomeDescription:
    "想做哪种产品的包装？先把你要做的产品（类别）发给我，比如：核桃、蜂蜜、鸡蛋、茶、果干…",
  suggestions: [
    { label: "核桃", text: "我要做核桃的包装" },
    { label: "蜂蜜", text: "我要做蜂蜜的包装" },
    { label: "鸡蛋", text: "我要做鸡蛋的包装" },
    { label: "果干", text: "我要做果干的包装" },
  ],
});

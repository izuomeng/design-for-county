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
  welcomeTitle: "寻美 · AI 包装小助手",
  welcomeDescription: "告诉我你卖什么，我帮你几步出一版能下载的包装图。",
  suggestions: [
    { label: "我想做蜂蜜的包装" },
    { label: "给我的茶叶设计个包装" },
    { label: "果干包装" },
  ],
});

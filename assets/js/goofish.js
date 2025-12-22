let isEncrypting = false;       // 防止重复点击
let lastClipboardContent = '';  // 缓存上一次写入的内容
async function handleEncrypt() {
    if (isEncrypting) {
        showToast("正在处理，请稍候…", false);
        return;
    }
    isEncrypting = true;
    try {
        const text = await navigator.clipboard.readText();
        if (!text) {
            showNotification("剪切板为空", false, 'goofish-toast');
            return;
        }
        if (text === lastClipboardContent) {
            showNotification("请勿重复点击", false, 'goofish-toast');
            return;
        }
        const res = await fetch('/goofish/contentEncrypt', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text})
        });
        const data = await res.json();
        if (!data.success) {
            showNotification("闲鱼内容加密失败", false, 'goofish-toast');
            return;
        }
        lastClipboardContent = data.result;
        await navigator.clipboard.writeText(data.result);
        showNotification("闲鱼内容已加密复制到剪贴板", false, 'goofish-toast');
    } catch (err) {
        showNotification("请允许剪切板权限", false, 'goofish-toast');
    } finally {
        isEncrypting = false;
    }
}

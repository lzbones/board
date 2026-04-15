let boardData = [];
const container = document.getElementById('board-container');
const modal = document.getElementById('confirm-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const btnConfirm = document.getElementById('modal-confirm');
const btnCancel = document.getElementById('modal-cancel');

function init() {
    renderSlots();
    pollData();
    setupGlobalKeyboard();
}

function renderSlots() {
    container.innerHTML = '';
    for (let i = 0; i < 8; i++) {
        const slotEl = document.createElement('div');
        slotEl.className = 'slot-card';
        slotEl.tabIndex = 0; // Focusable for keyboard
        slotEl.dataset.id = i;
        slotEl.innerHTML = `
            <div class="slot-id-badge">Slot ${i + 1}</div>
            <div class="slot-content-area" id="content-area-${i}">
                <textarea class="mobile-paste-area" placeholder="空\n点击此处\n长按触发「粘贴」以录入"></textarea>
            </div>
            <div class="slot-actions">
                <button class="btn btn-copy" onclick="handleCopy(event, ${i})">复制</button>
                <button class="btn btn-delete" onclick="prepareDelete(event, ${i})">删除</button>
                <button class="btn btn-upload" onclick="prepareUpload(event, ${i})">上传</button>
            </div>
            <input type="file" class="file-upload-input" id="file-${i}" onchange="handleFileChange(event, ${i})">
        `;

        let singleClickTimer;
        // Interaction processing
        slotEl.addEventListener('click', (e) => {
            if (['BUTTON', 'INPUT', 'TEXTAREA'].indexOf(e.target.tagName) === -1 && !e.target.classList.contains('content-text')) {
                // Focus element safely and copy
                slotEl.focus();
                handleCopy(e, i);
            }
        });

        slotEl.addEventListener('paste', (e) => handleSlotPaste(e, i));
        slotEl.addEventListener('dragover', (e) => { e.preventDefault(); slotEl.classList.add('dragover'); });
        slotEl.addEventListener('dragleave', (e) => { e.preventDefault(); slotEl.classList.remove('dragover'); });
        slotEl.addEventListener('drop', (e) => { e.preventDefault(); slotEl.classList.remove('dragover'); handleFileDrop(e, i); });

        container.appendChild(slotEl);
    }
}

async function pollData() {
    try {
        const res = await fetch('/api/board');
        if (res.ok) {
            const data = await res.json();
            updateUI(data);
        }
    } catch (e) { console.error('Sync error:', e); }
    setTimeout(pollData, 1000);
}

function updateUI(data) {
    // Only update if fundamentally changed or specific elements. 
    // Here we update everything for simplicity, but avoid losing selection if editing.
    // Since we don't have editable fields, full replace is fine.
    boardData = data;
    data.forEach(slot => {
        const area = document.getElementById(`content-area-${slot.id}`);
        if (!area) return;

        if (slot.type === 'empty') {
            if (area.innerHTML.indexOf('mobile-paste-area') === -1) {
                area.innerHTML = `<textarea class="mobile-paste-area" placeholder="空\n点击此处\n长按触发「粘贴」以录入"></textarea>`;
            }
        } else if (slot.type === 'text') {
            const safeHtml = escapeHtml(slot.content);
            if (area.innerHTML.indexOf(safeHtml) === -1) {
                area.innerHTML = `<div class="content-text">${safeHtml}</div>`;
            }
        } else if (slot.type === 'image') {
            const tag = `<img src="/${slot.content}" class="content-image" alt="Image">`;
            if (area.innerHTML.indexOf(tag) === -1) area.innerHTML = tag;
        } else if (slot.type === 'file') {
            const tag = `
                <div class="content-file">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                    <div class="content-file-name">${escapeHtml(slot.filename)}</div>
                </div>`;
            if (area.innerHTML.indexOf(escapeHtml(slot.filename)) === -1) area.innerHTML = tag;
        }
    });
}

function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* --------------- Actions --------------- */

async function handleCopy(e, id) {
    if (e) e.stopPropagation();
    const slot = boardData[id];
    if (!slot || slot.type === 'empty') return;

    try {
        if (slot.type === 'text') {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(slot.content);
            } else {
                fallbackCopyTextToClipboard(slot.content);
            }
        } else if (slot.type === 'image') {
            const fallbackTextUrl = window.location.origin + "/" + slot.content;
            try {
                // Fetch image as blob
                const response = await fetch("/" + slot.content);
                let blob = await response.blob();

                let writeApiSuccess = false;
                if (navigator.clipboard && window.ClipboardItem) {
                    try {
                        let finalBlob = blob;
                        // Chrome and Firefox mostly prefer/allow 'image/png' on clipboard
                        if (blob.type !== 'image/png') {
                            const img = new Image();
                            img.crossOrigin = "Anonymous";
                            img.src = URL.createObjectURL(blob);
                            await new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = reject;
                            });

                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            finalBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                        }

                        await navigator.clipboard.write([
                            new ClipboardItem({ [finalBlob.type]: finalBlob })
                        ]);
                        writeApiSuccess = true;
                    } catch (err) {
                        console.error('navigator.clipboard.write failed', err);
                    }
                }

                if (!writeApiSuccess) {
                    // 当处于 HTTP / 无安全权限 上下文时，使用底层富文本复制 Base64 源码实现任意环境贴图！
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        fallbackCopyHtmlImageToClipboard(reader.result, fallbackTextUrl);
                    }
                    reader.readAsDataURL(blob);
                }
            } catch (err) {
                console.error('Image fetch error', err);
                fallbackCopyTextToClipboard(fallbackTextUrl);
            }
        } else {
            // General files fallback to URL
            const textToCopy = window.location.origin + "/" + slot.content;
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(textToCopy);
            } else {
                fallbackCopyTextToClipboard(textToCopy);
            }
        }
        showToast(`Slot ${id + 1} Copied!`, id);
    } catch (err) {
        console.error('Copy failed', err);
        showToast('提取限制：检查相关内容是否被浏览器拦截', id);
    }
}

// 富文本环境 Base64 图片复制兼容方案
function fallbackCopyHtmlImageToClipboard(dataUrl, fallbackText) {
    const div = document.createElement('div');
    div.contentEditable = true;
    div.style.position = 'fixed';
    div.style.top = '0';
    div.style.left = '0';
    div.style.opacity = '0';

    const img = document.createElement('img');
    img.src = dataUrl;
    div.appendChild(img);
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let success = false;
    try {
        success = document.execCommand('copy');
    } catch (e) {
        console.error("Fallback image execCommand failed", e);
    }

    document.body.removeChild(div);
    sel.removeAllRanges();

    if (!success) {
        fallbackCopyTextToClipboard(fallbackText);
    }
}

// 降级兼容方案：在非 https/localhost 环境下，navigator.clipboard 会被浏览器禁用，只能用底层 execCommand
function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // 避免页面滚动
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (!successful) throw new Error('execCommand failed');
    } catch (err) {
        console.error('Fallback: unable to copy', err);
        throw err;
    }
    document.body.removeChild(textArea);
}

function prepareClearAll() {
    showModal('危险操作', `确定要清空所有面板的全部内容吗？这会永久删除全部文件。`, true, () => executeClearAll());
}

async function executeClearAll() {
    await fetch(`/api/board`, { method: 'DELETE' });
    hideModal(); pollData();
}

function prepareDelete(e, id) {
    e.stopPropagation();
    if (boardData[id].type === 'empty') return;
    showModal('二次提示', `确定要删除第 ${id + 1} 号剪切板的内容吗？`, true, () => executeDelete(id));
}

async function executeDelete(id) {
    await fetch(`/api/board/${id}`, { method: 'DELETE' });
    hideModal(); pollData();
}

function prepareUpload(e, id) {
    e.stopPropagation();
    if (boardData[id].type !== 'empty') {
        showModal('覆写提示', `第 ${id + 1} 号已有内容。确定要覆盖上传吗？`, false, () => {
            hideModal();
            document.getElementById(`file-${id}`).click();
        });
    } else {
        document.getElementById(`file-${id}`).click();
    }
}

async function handleFileChange(e, id) {
    if (e.target.files.length > 0) {
        await uploadFileAPI(id, e.target.files[0]);
        e.target.value = '';
    }
}

async function uploadFileAPI(id, file) {
    const fd = new FormData(); fd.append('file', file);
    await fetch(`/api/board/${id}/file`, { method: 'POST', body: fd });
    pollData();
}

async function uploadTextAPI(id, text) {
    const fd = new URLSearchParams(); fd.append('content', text);
    await fetch(`/api/board/${id}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd
    });
    pollData();
}

/* --------------- Drag and Drop & Paste --------------- */
function handleFileDrop(e, id) {
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        doUploadOrConfirm(id, file, true);
    }
}

function handleSlotPaste(e, id) {
    e.preventDefault();
    const items = (e.clipboardData || window.clipboardData).items;
    let file = null; let text = '';

    if (items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                file = items[i].getAsFile();
                break;
            }
        }
    }

    if (file) {
        doUploadOrConfirm(id, file, true);
    } else {
        text = (e.originalEvent || e).clipboardData.getData('text/plain');
        if (text) doUploadOrConfirm(id, text, false);
    }
}

async function doUploadOrConfirm(id, data, isFile) {
    // 核心硬核修复：浏览器的底层安全机制判定
    // 剪贴板提取出来的 file 对象，在超出当前原生事件流（Event Loop）或者挂起之后，其底层内存指针会被立刻销毁！
    // 如果我们带着这个文件去等用户点击“确认”弹窗，等他点完，这个 file 早变空了跑不通 fetch。
    // 所以必须在这里：在弹窗拦截前，强行将它的内容读取切走，做成一个全新的本地 JS 内存 File 副本！
    if (isFile) {
        try {
            const buffer = await data.arrayBuffer();
            data = new File([buffer], data.name || "paste_image.png", { type: data.type });
        } catch (err) {
            console.error("读取内存文件失败", err);
            return;
        }
    }

    const action = () => isFile ? uploadFileAPI(id, data) : uploadTextAPI(id, data);
    if (boardData[id].type !== 'empty') {
        showModal('覆写提示', `剪切板已有内容，确认覆盖粘贴？`, false, () => {
            hideModal(); action();
        });
    } else { action(); }
}

/* --------------- Keyboard System --------------- */
function setupGlobalKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideModal();
                return;
            } else if (e.key === 'Enter') {
                e.preventDefault();
                btnConfirm.click();
                return;
            }
        }

        const focusedEl = document.activeElement;
        if (!focusedEl || !focusedEl.classList.contains('slot-card')) return;

        const id = parseInt(focusedEl.dataset.id);

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'c' || e.key === 'C') {
                handleCopy(null, id);
                e.preventDefault();
            } else if (e.key === 'x' || e.key === 'X') {
                handleCopy(null, id).then(() => executeDelete(id));
                e.preventDefault();
            }
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            if (boardData[id].type !== 'empty') {
                prepareDelete({ stopPropagation: () => { } }, id); e.preventDefault();
            }
        }
    });

    document.addEventListener('paste', (e) => {
        const focusedEl = document.activeElement;
        if (focusedEl && focusedEl.classList.contains('slot-card')) {
            // Let the slot's own paste event handler catch this if it has focus
        }
    });
}

function showModal(title, message, isDanger, onConfirm) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    btnConfirm.className = isDanger ? 'danger-btn' : '';
    btnConfirm.onclick = onConfirm;
    btnCancel.onclick = hideModal;
    modal.classList.remove('hidden');
}

function hideModal() { modal.classList.add('hidden'); }

function showToast(msg, id) {
    const slotCard = document.querySelector(`.slot-card[data-id="${id}"]`);
    if (slotCard) {
        const oldOutline = slotCard.style.outline;
        slotCard.style.outline = '2px solid #10b981'; // Green accent for copy success
        setTimeout(() => { slotCard.style.outline = oldOutline; }, 400);
    }
}

init();

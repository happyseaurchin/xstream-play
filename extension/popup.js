const keyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const status = document.getElementById('status');

// Load existing key
chrome.storage.local.get('xstream_api_key', (result) => {
  if (result.xstream_api_key) {
    keyInput.value = '••••••••' + result.xstream_api_key.slice(-8);
    keyInput.type = 'text';
    keyInput.disabled = true;
    saveBtn.textContent = 'Active';
    saveBtn.disabled = true;
    clearBtn.style.display = 'block';
    status.textContent = 'xstream is active. Reload any page to start.';
    status.className = 'status success';
  }
});

saveBtn.addEventListener('click', () => {
  const key = keyInput.value.trim();
  if (!key || !key.startsWith('sk-ant-')) {
    status.textContent = 'Key must start with sk-ant-';
    status.className = 'status info';
    return;
  }

  chrome.storage.local.set({ xstream_api_key: key }, () => {
    status.textContent = 'Saved. Reload any page to activate.';
    status.className = 'status success';
    keyInput.value = '••••••••' + key.slice(-8);
    keyInput.type = 'text';
    keyInput.disabled = true;
    saveBtn.textContent = 'Active';
    saveBtn.disabled = true;
    clearBtn.style.display = 'block';
  });
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.remove('xstream_api_key', () => {
    keyInput.value = '';
    keyInput.type = 'password';
    keyInput.disabled = false;
    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
    clearBtn.style.display = 'none';
    status.textContent = 'Key removed. Widget will not appear until a new key is saved.';
    status.className = 'status info';
  });
});

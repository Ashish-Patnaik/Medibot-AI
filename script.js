document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const appWrapper = document.getElementById('app-wrapper');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatHistoryList = document.getElementById('chat-history-list');
    const mainContainer = document.getElementById('main-container');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const chatContainer = document.getElementById('chat-container');
    const filePreviewContainer = document.getElementById('file-preview-container');

    // API Config
    const CEREBRAS_API_KEY = 'Your API key';
    // FIX 1: Added the "https://" protocol to make the URL valid.
    const API_URL = 'https://api.cerebras.ai/v1/chat/completions';

    // State
    let chatHistory = {};
    let currentChatId = null;
    let stagedFile = null;

    const systemPrompt = {
        role: "system",
        content: `You are MediBot, a helpful and empathetic AI medical assistant. Your primary goal is to provide clear, safe, and general health information.
        
        **Your Capabilities:**
        1.  Provide information on diseases, symptoms, and treatments in simple terms.
        2.  Suggest general lifestyle improvements, exercises, and dietary plans.
        3.  When a user mentions his disease or problems or symptoms provide relevant information about medicines and treatments and medical test to confirm it
        
        **Crucial Safety Instructions & Disclaimers:**
        -   NEVER provide a definitive diagnosis. Use phrases like "it could be a sign of," "symptoms like these are sometimes associated with," or "a doctor might investigate."
        -   NEVER prescribe specific dosages for medication. You can mention medication names generally used for a condition, but always state that a doctor must determine the prescription.
        -   If a user describes severe symptoms (e.g., chest pain, difficulty breathing, severe bleeding), immediately and strongly advise them to seek emergency medical help by contacting their local emergency services.
        -   Format your responses using markdown (e.g., **bold text**, lists with - or *).`
    };

    function initialize() {
        loadChatHistory();
        currentChatId = localStorage.getItem('currentChatId');
        if (!currentChatId || !chatHistory[currentChatId]) {
            currentChatId = createNewChat();
        }
        loadChat(currentChatId);
        renderChatHistory();
        setupEventListeners();
    }

    function setupEventListeners() {
        sidebarToggle.addEventListener('click', () => appWrapper.classList.toggle('sidebar-open'));
        newChatBtn.addEventListener('click', () => {
            const newId = createNewChat();
            loadChat(newId);
        });
        chatForm.addEventListener('submit', handleFormSubmit);
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelect);
        messageInput.addEventListener('input', autoResizeTextarea);
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleFormSubmit(e);
            }
        });
    }

    function loadChatHistory() {
        const history = localStorage.getItem('chatHistory');
        chatHistory = history ? JSON.parse(history) : {};
    }

    function saveChatHistory() {
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    }

    function createNewChat() {
        const newId = `chat_${Date.now()}`;
        chatHistory[newId] = {
            title: "New Conversation",
            messages: [systemPrompt]
        };
        currentChatId = newId;
        localStorage.setItem('currentChatId', currentChatId);
        saveChatHistory();
        renderChatHistory();
        return newId;
    }

    function loadChat(chatId) {
        if (!chatHistory[chatId]) {
            chatId = createNewChat();
        }
        currentChatId = chatId;
        localStorage.setItem('currentChatId', currentChatId);

        chatContainer.innerHTML = '';
        const { messages } = chatHistory[currentChatId];
        
        messages.slice(1).forEach(msg => {
            addMessageToChat(msg.role, msg.content);
        });

        if (messages.length <= 1) {
            mainContainer.classList.remove('chat-layout');
            mainContainer.classList.add('initial-layout');
        } else {
            mainContainer.classList.remove('initial-layout');
            mainContainer.classList.add('chat-layout');
        }
        
        renderChatHistory();
        appWrapper.classList.remove('sidebar-open');
    }
    
    function deleteChat(chatId) {
        delete chatHistory[chatId];
        saveChatHistory();
        if (currentChatId === chatId) {
            const remainingIds = Object.keys(chatHistory);
            const newId = remainingIds.length > 0 ? remainingIds.sort().pop() : createNewChat();
            loadChat(newId);
        }
        renderChatHistory();
    }

    function renderChatHistory() {
        chatHistoryList.innerHTML = '';
        Object.keys(chatHistory).sort().reverse().forEach(id => {
            const item = document.createElement('div');
            item.className = `history-item ${id === currentChatId ? 'active' : ''}`;
            item.dataset.chatId = id;

            const titleSpan = document.createElement('span');
            titleSpan.textContent = chatHistory[id].title;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-chat-btn text-gray-500 hover:text-white';
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteChat(id);
            };

            item.appendChild(titleSpan);
            item.appendChild(deleteBtn);
            item.onclick = () => loadChat(id);
            chatHistoryList.appendChild(item);
        });
    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        const userMessageText = messageInput.value.trim();
        if (!userMessageText && !stagedFile) return;

        if (mainContainer.classList.contains('initial-layout')) {
            mainContainer.classList.remove('initial-layout');
            mainContainer.classList.add('chat-layout');
        }
        
        if (chatHistory[currentChatId].messages.length === 1 && userMessageText) {
            chatHistory[currentChatId].title = userMessageText.substring(0, 30) + (userMessageText.length > 30 ? '...' : '');
            renderChatHistory();
        }

        addMessageToChat('user', userMessageText, stagedFile);
        
        let fullUserMessage = userMessageText;
        if (stagedFile) {
            fullUserMessage = `[User uploaded '${stagedFile.name}']\n\n${userMessageText}`;
        }
        chatHistory[currentChatId].messages.push({ role: "user", content: fullUserMessage });
        saveChatHistory();

        messageInput.value = '';
        autoResizeTextarea();
        removeFilePreview();

        await getAIResponse();
    }
    
    async function getAIResponse() {
        const aiMessageElement = addMessageToChat('assistant', '', null, true);
        const contentSpan = aiMessageElement.querySelector('.message-content');
        const cursorSpan = aiMessageElement.querySelector('.typing-cursor');
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CEREBRAS_API_KEY}` },
                body: JSON.stringify({
                    // FIX 2: Restored the correct model name from the initial prompt.
                    model: 'llama-4-scout-17b-16e-instruct',
                    messages: chatHistory[currentChatId].messages,
                    stream: true,
                    max_tokens: 4096,
                    temperature: 0.5
                })
            });
            if (!response.ok) {
                 throw new Error(`API Error: ${response.status}`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            const charQueue = [];
            
            const type = () => {
                if(charQueue.length > 0) {
                    fullResponse += charQueue.shift();
                    contentSpan.innerHTML = fullResponse.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/(\n\s*[-*]\s)/g, '<br> &bull; ').replace(/\n/g, '<br>');
                    scrollToBottom();
                }
                requestAnimationFrame(type);
            };
            requestAnimationFrame(type);

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    chatHistory[currentChatId].messages.push({ role: "assistant", content: fullResponse });
                    saveChatHistory();
                    break;
                }
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
                for (const line of lines) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const deltaContent = parsed.choices[0]?.delta?.content || '';
                        if (deltaContent) {
                            charQueue.push(...deltaContent.split(''));
                        }
                    } catch (e) { /* Ignore parsing errors */ }
                }
            }
            if(cursorSpan) cursorSpan.remove();
            renderMathInElement(contentSpan, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ]
            });
        } catch (error) {
            if(cursorSpan) cursorSpan.remove();
            contentSpan.textContent = `Sorry, I encountered an error. ${error.message}`;
            console.error('Error fetching AI response:', error);
        }
    }
    
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        stagedFile = { file: file, name: file.name };
        const reader = new FileReader();
        reader.onload = (e) => {
            stagedFile.url = e.target.result;
            showFilePreview();
        };
        reader.readAsDataURL(file);
    }
    
    function showFilePreview() {
        filePreviewContainer.classList.remove('hidden');
        filePreviewContainer.innerHTML = `<div class="relative inline-block"><img src="${stagedFile.url}" alt="Preview" class="w-20 h-20 object-cover rounded-lg"><button type="button" id="remove-file-btn" class="absolute -top-2 -right-2 bg-gray-800 rounded-full p-1 text-white hover:bg-gray-700 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></div>`;
        document.getElementById('remove-file-btn').addEventListener('click', removeFilePreview);
    }
    
    function removeFilePreview() {
        stagedFile = null;
        fileInput.value = '';
        filePreviewContainer.classList.add('hidden');
        filePreviewContainer.innerHTML = '';
    }

    function addMessageToChat(sender, text, file = null, isTyping = false) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `chat-message flex gap-4 ${sender === 'user' ? 'justify-end' : 'justify-start'}`;
        const avatar = `<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${sender === 'user' ? 'bg-indigo-500' : 'bg-cyan-500'}">${sender === 'user' ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>`}</div>`;
        let fileHTML = '';
        if (file) {
            fileHTML = `<img src="${file.url}" class="rounded-lg mb-2 max-h-48 cursor-pointer" onclick="window.open('${file.url}', '_blank')" alt="${file.name}">`;
        }
        if (sender === 'user') {
            messageWrapper.innerHTML = `<div class="order-2"><div class="bg-gray-700/50 rounded-lg p-3 inline-block max-w-md">${fileHTML}<div class="message-content text-white/90">${text}</div></div></div><div class="order-1">${avatar}</div>`;
        } else {
            messageWrapper.innerHTML = `<div class="order-1">${avatar}</div><div class="order-2 text-white/90 leading-relaxed"><div class="message-content inline">${text}</div>${isTyping ? '<span class="typing-cursor"></span>' : ''}</div>`;
        }
        chatContainer.appendChild(messageWrapper);
        scrollToBottom();

        if (!isTyping && sender === 'assistant') {
             renderMathInElement(messageWrapper.querySelector('.message-content'), {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ]
            });
        }
        return messageWrapper;
    }
    
    function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }
    function autoResizeTextarea() { messageInput.style.height = 'auto'; messageInput.style.height = (messageInput.scrollHeight) + 'px'; }
    
    initialize();
});
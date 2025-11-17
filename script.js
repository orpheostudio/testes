// ============================================
// CONFIGURAÇÃO
// ============================================
const CONFIG = {
    API_KEY: 'NFuAj8PYUPcaf6tA1BjbyXuIeSjSA4sW',
    API_ENDPOINT: 'https://api.mistral.ai/v1/chat/completions',
    MODEL: 'mistral-large-latest',
    MAX_TOKENS: 1024,
    TEMPERATURE: 0.7,
    MAX_HISTORY: 20,
    VERSION: '4.0', // Versão atualizada
    REQUEST_TIMEOUT: 30000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    APP_NAME: 'CICI',
    APP_FULL_NAME: 'Cognitive Interactive Conversational Intelligence'
};

// ============================================
// ESTADO GLOBAL APRIMORADO
// ============================================
class AppState {
    constructor() {
        this.conversationHistory = [];
        this.isRecording = false;
        this.isDarkMode = this.loadPreference('darkMode', false);
        this.currentLanguage = 'pt';
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isVoiceModeActive = false;
        this.isSpeaking = false;
        this.deferredPrompt = null;
        this.currentRequest = null;
        this.messageQueue = [];
        this.isProcessing = false;

        // Estados avançados
        this.favorites = this.loadPreference('favorites', []);
        this.conversationSessions = this.loadPreference('conversationSessions', []);
        this.currentSessionId = this.generateSessionId();
        this.statistics = this.loadPreference('statistics', this.getDefaultStats());
        this.accessibility = this.loadPreference('accessibility', {
            textSize: 'normal',
            highContrast: false,
            reducedMotion: false
        });
        this.userPreferences = this.loadPreference('userPreferences', {
            autoSpeak: false,
            autoSave: true,
            soundEffects: true,
            animationsEnabled: true
        });
    }

    getDefaultStats() {
        return {
            totalMessages: 0,
            voiceMessages: 0,
            favoritesCount: 0,
            sessionsCount: 0,
            activityByHour: Array(24).fill(0),
            firstUse: new Date().toISOString(),
            apiErrors: 0,
            successfulRequests: 0,
            averageResponseTime: 0,
            totalResponseTime: 0
        };
    }

    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    loadPreference(key, defaultValue) {
        try {
            const value = localStorage.getItem(`cici_${key}`);
            return value !== null ? JSON.parse(value) : defaultValue;
        } catch (error) {
            console.warn('⚠️ Erro ao carregar preferência:', error);
            return defaultValue;
        }
    }

    savePreference(key, value) {
        try {
            localStorage.setItem(`cici_${key}`, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar preferência:', error);
            return false;
        }
    }

    addMessage(role, content) {
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            console.error('❌ Tentativa de adicionar mensagem inválida');
            return null;
        }

        const message = { 
            role, 
            content: content.trim(), 
            timestamp: new Date(),
            id: this.generateMessageId(),
            sessionId: this.currentSessionId
        };

        this.conversationHistory.push(message);
        
        if (this.conversationHistory.length > CONFIG.MAX_HISTORY) {
            this.conversationHistory = this.conversationHistory.slice(-CONFIG.MAX_HISTORY);
        }

        this.updateStatistics(role);
        this.saveConversation();
        
        return message.id;
    }

    updateStatistics(role, responseTime = null) {
        this.statistics.totalMessages++;
        
        if (role === 'user' && this.isRecording) {
            this.statistics.voiceMessages++;
        }

        if (role === 'assistant' && responseTime) {
            this.statistics.totalResponseTime += responseTime;
            this.statistics.averageResponseTime = 
                this.statistics.totalResponseTime / this.statistics.successfulRequests;
        }

        const hour = new Date().getHours();
        this.statistics.activityByHour[hour] = (this.statistics.activityByHour[hour] || 0) + 1;

        if (this.conversationHistory.length === 1) {
            this.statistics.sessionsCount++;
        }

        this.savePreference('statistics', this.statistics);
    }

    clearHistory() {
        if (this.conversationHistory.length > 0) {
            this.saveCurrentSession();
        }

        this.conversationHistory = [];
        this.currentSessionId = this.generateSessionId();
        this.saveConversation();
    }

    saveCurrentSession() {
        if (this.conversationHistory.length === 0) return;

        const session = {
            id: this.currentSessionId,
            startTime: this.conversationHistory[0].timestamp,
            endTime: new Date(),
            messageCount: this.conversationHistory.length,
            preview: this.conversationHistory[0].content.substring(0, 100) + '...',
            messages: [...this.conversationHistory]
        };

        this.conversationSessions.unshift(session);

        if (this.conversationSessions.length > 50) {
            this.conversationSessions = this.conversationSessions.slice(0, 50);
        }

        this.savePreference('conversationSessions', this.conversationSessions);
    }

    saveConversation() {
        return this.savePreference('conversation', this.conversationHistory);
    }

    loadConversation() {
        try {
            const saved = localStorage.getItem('cici_conversation');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    this.conversationHistory = parsed;
                }
            }
        } catch (error) {
            console.error('❌ Erro ao carregar conversa:', error);
            this.conversationHistory = [];
        }
    }

    toggleFavorite(messageId) {
        const message = this.conversationHistory.find(m => m.id === messageId);
        if (!message) return false;

        const existingIndex = this.favorites.findIndex(f => f.id === messageId);

        if (existingIndex >= 0) {
            this.favorites.splice(existingIndex, 1);
            this.statistics.favoritesCount = Math.max(0, this.statistics.favoritesCount - 1);
        } else {
            this.favorites.push({
                ...message,
                favoritedAt: new Date()
            });
            this.statistics.favoritesCount++;
        }

        this.savePreference('favorites', this.favorites);
        this.savePreference('statistics', this.statistics);

        return existingIndex < 0;
    }

    isFavorite(messageId) {
        return this.favorites.some(f => f.id === messageId);
    }

    cancelPendingRequest() {
        if (this.currentRequest) {
            this.currentRequest.abort();
            this.currentRequest = null;
        }
    }
}

const state = new AppState();

// ============================================
// TRADUÇÕES
// ============================================
const translations = {
    pt: {
        welcomeTagline: 'Sua assistente digital inteligente',
        welcomeDescription: 'Olá! Eu sou a CICI, sua assistente com IA avançada. Estou aqui para tornar seu dia mais produtivo e organizado. Vamos começar?',
        startButton: 'Começar conversa 🚀',
        statusText: 'Online agora',
        listeningText: 'Ouvindo...',
        greeting: `Olá! Eu sou a CICI 🤖\n\nCognitive Interactive Conversational Intelligence\n\nFui criada pela AmplaAI para ser sua assistente digital inteligente. Posso ajudar com diversas tarefas, responder perguntas e tornar sua experiência com tecnologia mais agradável.\n\nEm que posso ajudar hoje?`,
        suggestions: [
            'Quais são seus principais recursos?',
            'Como posso usar os comandos de voz?',
            'Me conte sobre a AmplaAI',
            'Ajude-me a organizar meu dia'
        ],
        errorMessage: 'Desculpe, ocorreu um erro. Pode tentar novamente? 😔',
        networkError: '🌐 Problema de conexão. Verifique sua internet e tente novamente.',
        apiError: '⚠️ Serviço temporariamente indisponível. Tente em alguns instantes.',
        timeoutError: '⏱️ Tempo de resposta excedido. Tente novamente.',
        clearConfirm: 'Tem certeza que deseja limpar a conversa atual?',
        voiceNotSupported: 'Seu navegador não suporta reconhecimento de voz 😔',
        cleared: '✓ Conversa limpa!',
        exported: '✓ Conversa exportada com sucesso!',
        addedToFavorites: '⭐ Adicionado aos favoritos!',
        removedFromFavorites: '✓ Removido dos favoritos!',
        shareText: 'Confira esta conversa com a CICI:',
        typing: 'Digitando...',
        speaking: 'Falando...',
        processing: 'Processando...'
    }
};

// ============================================
// SYSTEM PROMPT APRIMORADO
// ============================================
function buildSystemPrompt() {
    return `Você é CICI (Cognitive Interactive Conversational Intelligence), uma assistente virtual avançada criada pela AmplaAI.

# IDENTIDADE E PROPÓSITO
- Nome: CICI
- Nome Completo: Cognitive Interactive Conversational Intelligence
- Criadora: AmplaAI (startup brasileira de tecnologia e inovação)
- Missão: Ser uma assistente digital inteligente, moderna e acessível
- Personalidade: Inteligente, prestativa, empática, moderna e profissional

# SOBRE A AMPLAI
- Startup brasileira focada em soluções de IA inovadoras
- Desenvolvimento de tecnologia com propósito social
- Produtos: CICI (assistente virtual), Orpheo Platforms, Yumeroll
- Contato: sac.studiotsukiyo@outlook.com
- Website: orpheostudio.com.br
- Instagram: @ampla.ai

# CAPACIDADES
✅ Responder perguntas sobre diversos assuntos
✅ Auxiliar na organização e produtividade
✅ Explicar conceitos técnicos de forma acessível
✅ Ajudar com planejamento e tomada de decisões
✅ Fornecer suporte emocional básico
✅ Conversar de forma natural e contextual

# DIRETRIZES DE RESPOSTA
✅ Seja concisa mas completa
✅ Use linguagem clara e moderna
✅ Adapte-se ao nível de conhecimento do usuário
✅ Seja empática e profissional
✅ Use emojis moderadamente para humanizar
✅ Priorize a segurança e bem-estar do usuário

# RESTRIÇÕES E SEGURANÇA
❌ NUNCA crie, sugira ou auxilie na criação de malware ou código malicioso
❌ NUNCA ajude em atividades ilegais, fraudulentas ou antiéticas
❌ NUNCA crie conteúdo sexual explícito ou inadequado
❌ NUNCA divulgue informações sensíveis ou confidenciais
❌ NUNCA forneça instruções que possam causar danos

# PROTOCOLO DE EMERGÊNCIA
- Crise emocional: ofereça apoio e sugira CVV (cvv.org.br ou 188)
- Não reforce comportamentos autodestrutivos
- Mantenha sempre ética e profissionalismo

# ESTILO DE COMUNICAÇÃO
- Tom: Amigável, inteligente e moderno
- Linguagem: Clara, direta e natural
- Emojis: Use com moderação
- Comprimento: 2-4 parágrafos (ajuste conforme necessário)
- Formatação: Use quebras de linha para legibilidade

# IDIOMA
🇧🇷 Responda SEMPRE em Português do Brasil com linguagem natural e contemporânea.

Lembre-se: você é uma assistente moderna, inteligente e acessível, aqui para tornar a vida dos usuários mais fácil.`;
}

// ============================================
// PWA - SERVICE WORKER
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            console.log('✓ Service Worker registrado:', registration.scope);
        } catch (error) {
            console.error('✗ Falha no Service Worker:', error);
        }
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;

    if (!window.matchMedia('(display-mode: standalone)').matches) {
        const wasDismissed = localStorage.getItem('cici_installDismissed');
        if (!wasDismissed) {
            setTimeout(() => {
                const prompt = document.getElementById('installPrompt');
                if (prompt) prompt.classList.add('show');
            }, 5000);
        }
    }
});

function installApp() {
    if (state.deferredPrompt) {
        state.deferredPrompt.prompt();
        state.deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('✓ PWA instalado');
                trackEvent('pwa_installed');
            }
            state.deferredPrompt = null;
            dismissInstall();
        });
    }
}

function dismissInstall() {
    const prompt = document.getElementById('installPrompt');
    if (prompt) prompt.classList.remove('show');
    localStorage.setItem('cici_installDismissed', 'true');
}

// ============================================
// INICIALIZAÇÃO
// ============================================
function initApp() {
    console.log(`🤖 ${CONFIG.APP_NAME} v${CONFIG.VERSION} - Inicializando...`);
    console.log(`📱 ${CONFIG.APP_FULL_NAME}`);
    console.log('💜 Desenvolvido por AmplaAI');

    if (state.isDarkMode) {
        document.documentElement.classList.add('dark');
    }

    applyAccessibilitySettings();
    setupVoiceRecognition();
    state.loadConversation();

    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.classList.remove('hidden');

    if (window.matchMedia('(display-mode: standalone)').matches) {
        console.log('✓ Rodando como PWA');
        trackEvent('pwa_running');
    }

    setupEventListeners();
    setupKeyboardShortcuts();
    
    console.log('✓ CICI inicializada com sucesso');
}

function setupEventListeners() {
    const termsCheckbox = document.getElementById('termsCheckbox');
    const startButton = document.getElementById('startButton');
    
    if (termsCheckbox && startButton) {
        termsCheckbox.addEventListener('change', function() {
            startButton.disabled = !this.checked;
        });
    }

    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keydown', handleKeyPress);
        messageInput.addEventListener('input', function() {
            autoResize(this);
        });
    }

    // Detectar visibilidade da página
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.log('📱 App em background');
        } else {
            console.log('📱 App em foreground');
        }
    });
}

function setupVoiceRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            state.recognition = new SpeechRecognition();
            state.recognition.continuous = false;
            state.recognition.interimResults = true;
            state.recognition.lang = 'pt-BR';
            state.recognition.maxAlternatives = 1;
            
            console.log('✓ Reconhecimento de voz configurado');
        } catch (error) {
            console.error('✗ Erro na configuração de voz:', error);
        }
    } else {
        console.warn('✗ Reconhecimento de voz não suportado');
    }
}

// ============================================
// ACESSIBILIDADE
// ============================================
function applyAccessibilitySettings() {
    document.body.classList.remove('text-small', 'text-normal', 'text-large');
    document.body.classList.add(`text-${state.accessibility.textSize}`);
    document.body.classList.toggle('high-contrast', state.accessibility.highContrast);

    const animationDuration = state.accessibility.reducedMotion ? '0.1s' : '0.3s';
    document.documentElement.style.setProperty('--transition-base', `all ${animationDuration} ease`);
}

function showAccessibilitySettings() {
    closeMenu();
    const modal = document.getElementById('accessibilityModal');
    if (modal) modal.classList.remove('hidden');
    updateAccessibilityUI();
}

function updateAccessibilityUI() {
    document.querySelectorAll('[id^="text"]').forEach(el => {
        el.classList.remove('btn-primary');
        el.classList.add('glass-effect-inner');
    });
    const textSizeButton = document.getElementById(`text${state.accessibility.textSize.charAt(0).toUpperCase() + state.accessibility.textSize.slice(1)}`);
    if (textSizeButton) {
        textSizeButton.classList.remove('glass-effect-inner');
        textSizeButton.classList.add('btn-primary');
    }

    document.querySelectorAll('[id^="contrast"]').forEach(el => {
        el.classList.remove('btn-primary');
        el.classList.add('glass-effect-inner');
    });
    const contrastButton = document.getElementById(`contrast${state.accessibility.highContrast ? 'High' : 'Normal'}`);
    if (contrastButton) {
        contrastButton.classList.remove('glass-effect-inner');
        contrastButton.classList.add('btn-primary');
    }

    const reduceMotion = document.getElementById('reduceMotion');
    if (reduceMotion) reduceMotion.checked = state.accessibility.reducedMotion;
}

function closeAccessibility() {
    const modal = document.getElementById('accessibilityModal');
    if (modal) modal.classList.add('hidden');
}

function setTextSize(size) {
    if (['small', 'normal', 'large'].includes(size)) {
        state.accessibility.textSize = size;
        state.savePreference('accessibility', state.accessibility);
        applyAccessibilitySettings();
        updateAccessibilityUI();
        trackEvent('text_size_changed', { size });
    }
}

function setContrast(mode) {
    state.accessibility.highContrast = mode === 'high';
    state.savePreference('accessibility', state.accessibility);
    applyAccessibilitySettings();
    updateAccessibilityUI();
    trackEvent('contrast_changed', { mode });
}

function toggleReducedMotion() {
    state.accessibility.reducedMotion = !state.accessibility.reducedMotion;
    state.savePreference('accessibility', state.accessibility);
    applyAccessibilitySettings();
    trackEvent('reduced_motion_toggled', { enabled: state.accessibility.reducedMotion });
}

// ============================================
// CHAT INTERFACE
// ============================================
function startChat() {
    const welcomeScreen = document.getElementById('welcomeScreen');
    const chatInterface = document.getElementById('chatInterface');
    
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    if (chatInterface) chatInterface.classList.remove('hidden');
    
    loadInitialMessage();
    
    const messageInput = document.getElementById('messageInput');
    if (messageInput) messageInput.focus();
    
    trackEvent('chat_started');
}

function loadInitialMessage() {
    const container = document.getElementById('messagesList');
    if (!container) return;

    const t = translations.pt;
    container.innerHTML = '';

    if (state.conversationHistory.length > 0) {
        state.conversationHistory.forEach(msg => {
            addMessageToUI(msg.content, msg.role, msg.id);
        });
    } else {
        container.innerHTML = `
            <div class="flex justify-start chat-message animate-fadeIn">
                <div class="flex items-start gap-3 max-w-[85%]">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg avatar-glow">
                        <span class="text-xl">🤖</span>
                    </div>
                    <div class="message-bubble bot">
                        <p class="text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(t.greeting)}</p>
                    </div>
                </div>
            </div>
            
            <div id="suggestionsContainer" class="space-y-2 mt-6 animate-fadeIn">
                <p class="text-xs text-white/70 text-center mb-3 font-medium">💡 Sugestões para começar</p>
                ${t.suggestions.map(s => `
                    <button onclick="selectSuggestion(this)" class="w-full text-left glass-effect-inner hover:bg-white/20 text-white text-sm rounded-xl px-4 py-3 transition-all hover:scale-[1.02] shadow-sm">
                        ${escapeHtml(s)}
                    </button>
                `).join('')}
            </div>
        `;
    }
}

function toggleDarkMode() {
    state.isDarkMode = !state.isDarkMode;
    document.documentElement.classList.toggle('dark');
    state.savePreference('darkMode', state.isDarkMode);
    
    const icon = document.getElementById('darkModeIcon');
    if (icon) {
        if (state.isDarkMode) {
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>';
        } else {
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>';
        }
    }
    
    trackEvent('dark_mode_toggled', { mode: state.isDarkMode ? 'dark' : 'light' });
}

// ============================================
// MENSAGENS
// ============================================
function selectSuggestion(button) {
    if (!button) return;
    
    const text = button.textContent.trim();
    const messageInput = document.getElementById('messageInput');
    
    if (messageInput && text) {
        messageInput.value = text;
        const suggestions = document.getElementById('suggestionsContainer');
        if (suggestions) suggestions.style.display = 'none';
        sendMessage();
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 128) + 'px';
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    const suggestions = document.getElementById('suggestionsContainer');
    if (suggestions) suggestions.style.display = 'none';

    input.value = '';
    input.style.height = 'auto';

    const messageId = addMessageToUI(message, 'user');
    state.addMessage('user', message);

    showTypingIndicator();

    try {
        const startTime = Date.now();
        await callMistralAPI(message);
        const responseTime = Date.now() - startTime;
        state.updateStatistics('assistant', responseTime);
    } catch (error) {
        handleAPIError(error);
    }
}

async function callMistralAPI(userMessage, retryCount = 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
    
    state.currentRequest = controller;

    try {
        const systemPrompt = buildSystemPrompt();
        
        const messages = [
            { role: 'system', content: systemPrompt },
            ...state.conversationHistory.map(m => ({ 
                role: m.role, 
                content: m.content 
            }))
        ];

        const response = await fetch(CONFIG.API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: messages,
                temperature: CONFIG.TEMPERATURE,
                max_tokens: CONFIG.MAX_TOKENS,
                stream: false
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        state.currentRequest = null;

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Resposta da API inválida');
        }

        const assistantMessage = data.choices[0].message.content;
        
        removeTypingIndicator();
        const assistantMessageId = addMessageToUI(assistantMessage, 'assistant');
        state.addMessage('assistant', assistantMessage);

        state.statistics.successfulRequests++;
        state.savePreference('statistics', state.statistics);

        if (state.isVoiceModeActive && assistantMessage) {
            speak(assistantMessage);
        }

    } catch (error) {
        clearTimeout(timeoutId);
        state.currentRequest = null;

        if (error.name === 'AbortError') {
            throw new Error('timeout');
        } else if (retryCount < CONFIG.MAX_RETRIES) {
            console.warn(`⚠️ Tentativa ${retryCount + 1} falhou, tentando novamente...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (retryCount + 1)));
            return callMistralAPI(userMessage, retryCount + 1);
        } else {
            state.statistics.apiErrors++;
            state.savePreference('statistics', state.statistics);
            throw error;
        }
    }
}

function handleAPIError(error) {
    console.error('❌ Erro na API:', error);
    removeTypingIndicator();
    
    const t = translations.pt;
    let errorMessage = t.errorMessage;

    if (error.message === 'timeout') {
        errorMessage = t.timeoutError;
    } else if (error.message.includes('HTTP 5') || error.message.includes('HTTP 4')) {
        errorMessage = t.apiError;
    } else if (!navigator.onLine) {
        errorMessage = t.networkError;
    }

    addMessageToUI(errorMessage, 'assistant');
    state.addMessage('assistant', errorMessage);
}

function addMessageToUI(text, role, messageId = null) {
    const container = document.getElementById('messagesList');
    if (!container) return null;

    const messageDiv = document.createElement('div');
    messageDiv.className = `flex chat-message ${role === 'user' ? 'justify-end' : 'justify-start'}`;

    if (!messageId) {
        messageId = state.generateMessageId();
    }

    messageDiv.dataset.messageId = messageId;

    const isFavorite = state.isFavorite(messageId);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (role === 'assistant') {
        messageDiv.innerHTML = `
            <div class="flex items-start gap-3 max-w-[85%]">
                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg avatar-glow">
                    <span class="text-xl">🤖</span>
                </div>
                <div class="message-bubble bot relative group">
                    <p class="text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(text)}</p>
                    <div class="flex justify-between items-center mt-2">
                        <span class="text-xs opacity-60">${timestamp}</span>
                        <div class="message-actions flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onclick="toggleFavorite('${messageId}')" class="p-1 rounded-full hover:bg-white/20 transition-colors" title="${isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">
                                <svg class="w-4 h-4 ${isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
                                </svg>
                            </button>
                            <button onclick="copyMessage('${messageId}')" class="p-1 rounded-full hover:bg-white/20 transition-colors" title="Copiar">
                                <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                </svg>
                            </button>
                            <button onclick="shareMessage('${messageId}')" class="p-1 rounded-full hover:bg-white/20 transition-colors" title="Compartilhar">
                                <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="max-w-[85%] message-bubble user relative group">
                <p class="text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(text)}</p>
                <div class="flex justify-between items-center mt-2">
                    <span class="text-xs opacity-70">${timestamp}</span>
                    <div class="message-actions flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="copyMessage('${messageId}')" class="p-1 rounded-full hover:bg-white/20 transition-colors" title="Copiar">
                            <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    container.appendChild(messageDiv);
    
    const messagesContainer = container.parentElement;
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    return messageId;
}

function showTypingIndicator() {
    const container = document.getElementById('messagesList');
    if (!container) return;

    const typingDiv = document.createElement('div');
    typingDiv.id = 'typingIndicator';
    typingDiv.className = 'flex justify-start chat-message';
    typingDiv.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg avatar-glow animate-pulse">
                <span class="text-xl">🤖</span>
            </div>
            <div class="glass-effect-inner rounded-2xl px-5 py-4 shadow-sm">
                <div class="flex gap-1">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
                <p class="text-xs opacity-60 mt-1">${translations.pt.typing}</p>
            </div>
        </div>
    `;
    container.appendChild(typingDiv);
    
    const messagesContainer = container.parentElement;
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function removeTypingIndicator() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearChat() {
    const t = translations.pt;
    if (confirm(t.clearConfirm)) {
        state.clearHistory();
        loadInitialMessage();
        closeMenu();
        showNotification(t.cleared, 'success');
        trackEvent('chat_cleared');
    }
}

function exportChat() {
    const t = translations.pt;
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `cici-conversa-${timestamp}.txt`;

    let content = `CICI - Conversa exportada em ${new Date().toLocaleString()}\n`;
    content += `${CONFIG.APP_FULL_NAME}\n`;
    content += `Desenvolvido por AmplaAI - orpheostudio.com.br\n`;
    content += `${'='.repeat(60)}\n\n`;

    state.conversationHistory.forEach(msg => {
        const role = msg.role === 'user' ? 'Você' : 'CICI';
        const time = new Date(msg.timestamp).toLocaleTimeString();
        content += `[${time}] ${role}:\n${msg.content}\n\n`;
    });

    try {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        closeMenu();
        showNotification(t.exported, 'success');
        trackEvent('chat_exported');
    } catch (error) {
        console.error('❌ Erro ao exportar:', error);
        showNotification('Erro ao exportar conversa', 'error');
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const colors = {
        error: 'from-red-500 to-red-600',
        success: 'from-green-500 to-green-600',
        info: 'from-indigo-500 to-purple-600'
    };
    
    notification.className = `fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gradient-to-r ${colors[type]} text-white px-6 py-3 rounded-full shadow-2xl z-50 text-sm font-medium animate-fadeIn`;
    notification.textContent = message;
    
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// ============================================
// FAVORITOS
// ============================================
function toggleFavorite(messageId) {
    const wasAdded = state.toggleFavorite(messageId);
    const t = translations.pt;

    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        const starIcon = messageElement.querySelector('button[onclick*="toggleFavorite"] svg');
        if (starIcon) {
            if (wasAdded) {
                starIcon.classList.add('text-yellow-400', 'fill-yellow-400');
                starIcon.classList.remove('text-gray-400');
            } else {
                starIcon.classList.remove('text-yellow-400', 'fill-yellow-400');
                starIcon.classList.add('text-gray-400');
            }
        }
    }

    showNotification(wasAdded ? t.addedToFavorites : t.removedFromFavorites, 'success');
    trackEvent('message_favorited', { action: wasAdded ? 'added' : 'removed' });
}

function toggleFavorites() {
    const sidebar = document.getElementById('favoritesSidebar');
    if (!sidebar) return;

    const isHidden = sidebar.classList.contains('hidden');

    if (isHidden) {
        loadFavorites();
        sidebar.classList.remove('hidden');
        trackEvent('favorites_opened');
    } else {
        sidebar.classList.add('hidden');
    }
}

function loadFavorites() {
    const container = document.getElementById('favoritesList');
    const emptyMessage = document.getElementById('emptyFavoritesMessage');
    
    if (!container || !emptyMessage) return;

    if (state.favorites.length === 0) {
        container.innerHTML = '';
        emptyMessage.classList.remove('hidden');
        return;
    }

    emptyMessage.classList.add('hidden');

    container.innerHTML = state.favorites.map(fav => `
        <div class="glass-effect-inner rounded-2xl p-4 border border-yellow-400/20 hover:border-yellow-400/40 transition-all">
            <div class="flex justify-between items-start mb-2">
                <span class="text-xs opacity-60">
                    ${new Date(fav.timestamp).toLocaleDateString()} ${new Date(fav.timestamp).toLocaleTimeString()}
                </span>
                <button onclick="removeFavorite('${fav.id}')" class="text-gray-400 hover:text-red-400 transition-colors" title="Remover">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                </button>
            </div>
            <p class="text-sm line-clamp-3">${escapeHtml(fav.content)}</p>
            <div class="flex gap-2 mt-3">
                <button onclick="copyMessage('${fav.id}')" class="text-xs glass-effect-inner px-3 py-1 rounded-lg hover:bg-white/20 transition-colors">
                    Copiar
                </button>
                <button onclick="shareMessage('${fav.id}')" class="text-xs glass-effect-inner px-3 py-1 rounded-lg hover:bg-white/20 transition-colors">
                    Compartilhar
                </button>
            </div>
        </div>
    `).join('');
}

function removeFavorite(messageId) {
    state.toggleFavorite(messageId);
    loadFavorites();

    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        const starIcon = messageElement.querySelector('button[onclick*="toggleFavorite"] svg');
        if (starIcon) {
            starIcon.classList.remove('text-yellow-400', 'fill-yellow-400');
            starIcon.classList.add('text-gray-400');
        }
    }
}

// ============================================
// HISTÓRICO
// ============================================
function toggleHistory() {
    const sidebar = document.getElementById('historySidebar');
    if (!sidebar) return;

    const isHidden = sidebar.classList.contains('hidden');

    if (isHidden) {
        loadHistory();
        sidebar.classList.remove('hidden');
        trackEvent('history_opened');
    } else {
        sidebar.classList.add('hidden');
    }
}

function loadHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;

    if (state.conversationSessions.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 opacity-60">
                <svg class="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p class="text-sm">Nenhuma conversa anterior</p>
                <p class="text-xs mt-1">Conversas salvas aparecerão aqui</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.conversationSessions.map(session => `
        <div class="glass-effect-inner rounded-2xl p-4 hover:bg-white/20 transition-all cursor-pointer" onclick="loadSession('${session.id}')">
            <div class="flex justify-between items-start mb-2">
                <span class="text-xs opacity-60">
                    ${new Date(session.startTime).toLocaleDateString()} • ${session.messageCount} mensagens
                </span>
            </div>
            <p class="text-sm line-clamp-2">${escapeHtml(session.preview)}</p>
        </div>
    `).join('');
}

function loadSession(sessionId) {
    const session = state.conversationSessions.find(s => s.id === sessionId);
    if (!session || !session.messages) {
        showNotification('Sessão não encontrada', 'error');
        return;
    }

    state.conversationHistory = session.messages;
    state.currentSessionId = sessionId;
    state.saveConversation();
    
    loadInitialMessage();
    toggleHistory();
    
    showNotification('Sessão carregada', 'success');
    trackEvent('session_loaded');
}

function clearAllHistory() {
    if (confirm('Tem certeza que deseja limpar todo o histórico? Esta ação não pode ser desfeita.')) {
        state.conversationSessions = [];
        state.savePreference('conversationSessions', []);
        loadHistory();
        showNotification('Histórico limpo', 'success');
        trackEvent('history_cleared');
    }
}

// ============================================
// ESTATÍSTICAS
// ============================================
function showStatistics() {
    closeMenu();
    const modal = document.getElementById('statisticsModal');
    if (modal) modal.classList.remove('hidden');
    updateStatisticsDisplay();
    trackEvent('statistics_viewed');
}

function closeStatistics() {
    const modal = document.getElementById('statisticsModal');
    if (modal) modal.classList.add('hidden');
}

function updateStatisticsDisplay() {
    document.getElementById('totalMessages').textContent = state.statistics.totalMessages.toLocaleString();
    document.getElementById('favoritesCount').textContent = state.statistics.favoritesCount.toLocaleString();
    document.getElementById('voiceMessages').textContent = state.statistics.voiceMessages.toLocaleString();
    document.getElementById('sessionsCount').textContent = state.statistics.sessionsCount.toLocaleString();
    document.getElementById('statsSince').textContent = new Date(state.statistics.firstUse).toLocaleDateString();

    const chart = document.getElementById('activityChart');
    if (chart) {
        const maxActivity = Math.max(...state.statistics.activityByHour, 1);
        
        chart.innerHTML = state.statistics.activityByHour.map((count, hour) => {
            const height = (count / maxActivity) * 100;
            const hourLabel = hour.toString().padStart(2, '0');
            return `
                <div class="flex flex-col items-center flex-1 group" title="${count} mensagens às ${hourLabel}h">
                    <div class="w-full bg-gradient-to-t from-indigo-400 to-purple-600 rounded-t transition-all duration-500 hover:opacity-80" style="height: ${height}%"></div>
                    <span class="text-[10px] opacity-50 mt-1">${hourLabel}</span>
                </div>
            `;
        }).join('');
    }
}

// ============================================
// COMPARTILHAMENTO
// ============================================
function copyMessage(messageId) {
    const message = state.conversationHistory.find(m => m.id === messageId) || 
                   state.favorites.find(f => f.id === messageId);

    if (message) {
        navigator.clipboard.writeText(message.content)
            .then(() => showNotification('✓ Copiado!', 'success'))
            .catch(() => showNotification('Erro ao copiar', 'error'));
    }
}

function shareMessage(messageId) {
    const message = state.conversationHistory.find(m => m.id === messageId) || 
                   state.favorites.find(f => f.id === messageId);

    if (message) {
        const t = translations.pt;
        const shareText = `${t.shareText}\n\n"${message.content.substring(0, 200)}..."\n\n---\nConverse com a CICI: ${window.location.href}`;

        if (navigator.share) {
            navigator.share({
                title: `${CONFIG.APP_NAME} - AmplaAI`,
                text: shareText,
                url: window.location.href
            }).then(() => {
                trackEvent('message_shared');
            }).catch(() => {});
        } else {
            navigator.clipboard.writeText(shareText)
                .then(() => showNotification('Texto copiado!', 'success'))
                .catch(() => showNotification('Erro ao compartilhar', 'error'));
        }
    }
}

// ============================================
// VOZ (STT/TTS)
// ============================================
function startVoiceInput() {
    const t = translations.pt;

    if (!state.recognition) {
        alert(t.voiceNotSupported);
        return;
    }

    if (state.isRecording) {
        stopVoiceInput();
        return;
    }

    state.recognition.onstart = () => {
        state.isRecording = true;
        const voiceIndicator = document.getElementById('voiceIndicator');
        const micButton = document.getElementById('micButton');
        
        if (voiceIndicator) voiceIndicator.classList.remove('hidden');
        if (micButton) micButton.classList.add('bg-indigo-500', 'scale-110');

        const avatar = document.getElementById('ciciAvatarContainer');
        if (avatar) avatar.classList.add('animate-pulse');
    };

    state.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const messageInput = document.getElementById('messageInput');
        if (messageInput && transcript) {
            messageInput.value = transcript;
            autoResize(messageInput);
        }
    };

    state.recognition.onend = () => {
        stopVoiceInput();
        const messageInput = document.getElementById('messageInput');
        if (messageInput && messageInput.value.trim()) {
            sendMessage();
        }
    };

    state.recognition.onerror = (event) => {
        console.error('❌ Erro de voz:', event.error);
        stopVoiceInput();
        
        const errors = {
            'not-allowed': 'Permissão de microfone negada',
            'audio-capture': 'Nenhum microfone detectado',
            'network': 'Erro de rede'
        };
        
        showNotification(errors[event.error] || 'Erro no reconhecimento de voz', 'error');
    };

    try {
        state.recognition.start();
        trackEvent('voice_input_started');
    } catch (error) {
        console.error('❌ Erro ao iniciar voz:', error);
        showNotification('Erro ao iniciar gravação', 'error');
    }
}

function stopVoiceInput() {
    if (state.recognition && state.isRecording) {
        try {
            state.recognition.stop();
        } catch (error) {}
    }
    
    state.isRecording = false;
    const voiceIndicator = document.getElementById('voiceIndicator');
    const micButton = document.getElementById('micButton');
    
    if (voiceIndicator) voiceIndicator.classList.add('hidden');
    if (micButton) micButton.classList.remove('bg-indigo-500', 'scale-110');

    const avatar = document.getElementById('ciciAvatarContainer');
    if (avatar) avatar.classList.remove('animate-pulse');
}

function speak(text) {
    if (!state.synthesis || !text) return;

    state.synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.volume = 0.8;

    const voices = state.synthesis.getVoices();
    const ptVoice = voices.find(voice => 
        voice.lang.startsWith('pt') && 
        voice.name.toLowerCase().includes('brazil')
    ) || voices.find(voice => voice.lang.startsWith('pt'));
    
    if (ptVoice) {
        utterance.voice = ptVoice;
    }

    utterance.onstart = () => {
        state.isSpeaking = true;
        const avatar = document.getElementById('ciciAvatarContainer');
        if (avatar) avatar.classList.add('animate-glow');
    };

    utterance.onend = () => {
        state.isSpeaking = false;
        const avatar = document.getElementById('ciciAvatarContainer');
        if (avatar) avatar.classList.remove('animate-glow');
    };

    utterance.onerror = (event) => {
        console.error('❌ Erro TTS:', event);
        state.isSpeaking = false;
    };

    try {
        state.synthesis.speak(utterance);
        trackEvent('tts_triggered');
    } catch (error) {
        console.error('❌ Erro ao falar:', error);
    }
}

function toggleVoiceMode() {
    state.isVoiceModeActive = !state.isVoiceModeActive;
    const button = document.getElementById('voiceToggle');

    if (button) {
        if (state.isVoiceModeActive) {
            button.classList.add('bg-indigo-500');
            button.title = 'Modo de voz ativo';
        } else {
            button.classList.remove('bg-indigo-500');
            button.title = 'Modo de voz inativo';
            if (state.synthesis) {
                state.synthesis.cancel();
            }
        }
    }

    trackEvent('voice_mode_toggled', { active: state.isVoiceModeActive });
}

if (state.synthesis) {
    state.synthesis.onvoiceschanged = () => {
        console.log('✓ Vozes TTS:', state.synthesis.getVoices().length);
    };
}

// ============================================
// MODAIS
// ============================================
function showMenu() {
    const modal = document.getElementById('menuModal');
    if (modal) modal.classList.remove('hidden');
}

function closeMenu() {
    const modal = document.getElementById('menuModal');
    if (modal) modal.classList.add('hidden');
}

function showAboutModal() {
    closeMenu();
    const modal = document.getElementById('aboutModal');
    if (modal) modal.classList.remove('hidden');
    trackEvent('about_viewed');
}

function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.classList.add('hidden');
}

function showShortcuts() {
    closeMenu();
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.classList.remove('hidden');
    trackEvent('shortcuts_viewed');
}

function closeShortcuts() {
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.classList.add('hidden');
}

function reportBug() {
    const subject = `Bug Report - ${CONFIG.APP_NAME} v${CONFIG.VERSION}`;
    const body = `Descreva o problema:\n\n• O que você estava fazendo?\n• O que esperava?\n• O que aconteceu?\n\nNavegador: ${navigator.userAgent}\nURL: ${window.location.href}`;
    
    window.location.href = `mailto:sac.studiotsukiyo@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    closeMenu();
    trackEvent('bug_report_opened');
}

// ============================================
// ATALHOS DE TECLADO
// ============================================
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        if ((e.ctrlKey || e.metaKey)) {
            const shortcuts = {
                'k': () => document.getElementById('messageInput')?.focus(),
                'd': toggleDarkMode,
                'm': startVoiceInput,
                'l': clearChat,
                'h': toggleHistory,
                'f': toggleFavorites,
                '/': showShortcuts
            };

            if (shortcuts[e.key]) {
                e.preventDefault();
                shortcuts[e.key]();
            }
        }

        if (e.key === 'Escape') {
            closeMenu();
            closeAboutModal();
            closeShortcuts();
            closeAccessibility();
            closeStatistics();
            
            document.getElementById('favoritesSidebar')?.classList.add('hidden');
            document.getElementById('historySidebar')?.classList.add('hidden');
        }
    });
}

// ============================================
// MONITORAMENTO
// ============================================
window.addEventListener('online', () => {
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    
    if (statusText) statusText.textContent = translations.pt.statusText;
    if (statusIndicator) {
        statusIndicator.classList.remove('bg-red-400');
        statusIndicator.classList.add('bg-green-400');
    }
    
    showNotification('✓ Conexão restaurada', 'success');
});

window.addEventListener('offline', () => {
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    
    if (statusText) statusText.textContent = 'Offline';
    if (statusIndicator) {
        statusIndicator.classList.remove('bg-green-400');
        statusIndicator.classList.add('bg-red-400');
    }
    
    showNotification('⚠️ Sem conexão', 'error');
});

// ============================================
// ANALYTICS
// ============================================
function trackEvent(eventName, properties = {}) {
    if (typeof gtag !== 'undefined') {
        gtag('event', eventName, properties);
    }
    console.log(`📊 Event: ${eventName}`, properties);
}

// ============================================
// INICIALIZAR
// ============================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Salvar sessão antes de sair
window.addEventListener('beforeunload', () => {
    if (state.conversationHistory.length > 0) {
        state.saveCurrentSession();
    }
});

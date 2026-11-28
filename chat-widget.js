X/* ==========================================
   ICON INTEGRATED SERVICES
   CUSTOMER SUPPORT CHAT WIDGET
========================================== */

(() => {
    const API_BASE_URL = "https://icon-intergrated-backend.onrender.com";

    let csrfToken = null;
    let currentMode = "ai";
    let pollingTimer = null;
    let pollingInProgress = false;

    const chatHTML = `
        <button class="icon-chat-launcher" id="iconChatLauncher"
            aria-label="Open customer support chat">
            <span>💬</span>
            <span class="icon-chat-launcher-text">Chat with us</span>
        </button>

        <section class="icon-chat-panel" id="iconChatPanel" hidden
            aria-label="ICON customer support">

            <header class="icon-chat-header">
                <div>
                    <strong>ICON Support</strong>
                    <small>How can we help you today?</small>
                </div>
                <button id="iconChatClose" aria-label="Close chat">×</button>
            </header>

            <div class="icon-chat-modes">
                <button class="icon-chat-mode active" data-mode="ai">
                    AI Assistant
                </button>
                <button class="icon-chat-mode" data-mode="staff">
                    Live Staff
                </button>
            </div>

            <div class="icon-chat-messages" id="iconChatMessages"
                aria-live="polite" aria-relevant="additions">
                <div class="icon-chat-bubble bot">
                    Welcome to ICON Integrated Services! How may we assist you?
                </div>
            </div>

            <div class="icon-chat-status" id="iconChatStatus"
                role="status" aria-live="polite">
                AI Assistant is ready
            </div>

            <form id="iconChatForm" class="icon-chat-form">
                <label for="iconChatInput" class="sr-only">
                    Type your support message
                </label>

                <input
                    type="text"
                    id="iconChatInput"
                    placeholder="Type your message..."
                    maxlength="1000"
                    required
                    autocomplete="off"
                >

                <button type="submit" aria-label="Send message">➤</button>
            </form>
        </section>
    `;

    document.body.insertAdjacentHTML("beforeend", chatHTML);

    const launcher = document.getElementById("iconChatLauncher");
    const panel = document.getElementById("iconChatPanel");
    const closeButton = document.getElementById("iconChatClose");
    const messages = document.getElementById("iconChatMessages");
    const form = document.getElementById("iconChatForm");
    const input = document.getElementById("iconChatInput");
    const status = document.getElementById("iconChatStatus");
    const modeButtons = document.querySelectorAll(".icon-chat-mode");

    let conversationId = sessionStorage.getItem("iconConversationId");

    if (!conversationId) {
        conversationId = crypto.randomUUID();
        sessionStorage.setItem("iconConversationId", conversationId);
    }

    // ==========================================
    // CSRF SECURITY
    // ==========================================

    async function getCsrfToken() {
        const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
            method: "GET",
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.csrf_token) {
            throw new Error("Could not obtain security token.");
        }

        csrfToken = result.csrf_token;
        return csrfToken;
    }

    // ==========================================
    // SAFE MESSAGE DISPLAY
    // ==========================================

    function addMessage(message, sender) {
        const bubble = document.createElement("div");

        bubble.className = `icon-chat-bubble ${sender}`;
        bubble.textContent = message;

        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
    }

    // ==========================================
    // OPEN AND CLOSE CHAT
    // ==========================================

    function openChat() {
        panel.hidden = false;
        launcher.hidden = true;
        input.focus();

        if (currentMode === "staff") {
            startStaffPolling();
        }
    }

    function closeChat() {
        panel.hidden = true;
        launcher.hidden = false;
        stopStaffPolling();
    }

    // ==========================================
    // SWITCH CHAT MODE
    // ==========================================

    function setMode(mode) {
        currentMode = mode;

        modeButtons.forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.mode === mode
            );
        });

        status.textContent = mode === "ai"
            ? "AI Assistant is ready"
            : "Live staff support selected";

        if (mode === "staff") {
            addMessage(
                "You've selected live staff support. Send your message and our team can respond when an agent is available.",
                "bot"
            );

            sendStaffMessage(
                "Customer requested live staff support.",
                true
            );

            startStaffPolling();

        } else {
            stopStaffPolling();
        }
    }

    // ==========================================
    // SEND STAFF MESSAGE
    // ==========================================

    async function sendStaffMessage(message, systemNotice = false) {
        try {
            const token = await getCsrfToken();

            const response = await fetch(
                `${API_BASE_URL}/api/support/messages`,
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": token
                    },
                    body: JSON.stringify({
                        conversation_id: conversationId,
                        message,
                        system_notice: systemNotice
                    })
                }
            );

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    result.message || "Staff messaging is unavailable."
                );
            }

            return result;

        } catch (error) {
            status.textContent =
                "Staff messaging is currently unavailable.";

            console.error("Staff message error:", error);
            return null;
        }
    }

    // ==========================================
    // SEND AI MESSAGE
    // ==========================================

    async function sendAIMessage(message) {
        const token = await getCsrfToken();

        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": token
            },
            body: JSON.stringify({
                conversation_id: conversationId,
                message
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.message || "AI assistant unavailable."
            );
        }

        return result;
    }

    // ==========================================
    // CHECK STAFF MESSAGES
    // ==========================================

    async function pollStaffMessages() {
        if (currentMode !== "staff") return;

        try {
            const response = await fetch(
                `${API_BASE_URL}/api/support/messages/${encodeURIComponent(conversationId)}`,
                {
                    credentials: "include"
                }
            );

            if (!response.ok) return;

            const result = await response.json();

            if (!Array.isArray(result.messages)) return;

            result.messages.forEach(message => {
                // Only display replies sent by staff.
                if (
                    message.sender !== "staff" ||
                    message.system_notice
                ) {
                    return;
                }

                const key = String(message.id);

                if (!messages.querySelector(
                    `[data-message-id="${key}"]`
                )) {
                    const bubble = document.createElement("div");

                    bubble.className = "icon-chat-bubble staff";
                    bubble.dataset.messageId = key;
                    bubble.textContent = message.message;

                    messages.appendChild(bubble);
                }
            });

            messages.scrollTop = messages.scrollHeight;

        } catch (error) {
            console.error("Staff message check failed:", error);
        }
    }

    // ==========================================
    // PREVENT OVERLAPPING POLLING REQUESTS
    // ==========================================

    async function pollStaffMessagesSafely() {
        if (pollingInProgress) return;

        pollingInProgress = true;

        try {
            await pollStaffMessages();
        } finally {
            pollingInProgress = false;
        }
    }

    function startStaffPolling() {
        stopStaffPolling();

        pollStaffMessagesSafely();

        pollingTimer = setInterval(
            pollStaffMessagesSafely,
            5000
        );
    }

    function stopStaffPolling() {
        if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
        }
    }

    // ==========================================
    // CHAT CONTROLS
    // ==========================================

    launcher.addEventListener("click", openChat);
    closeButton.addEventListener("click", closeChat);

    modeButtons.forEach(button => {
        button.addEventListener("click", () => {
            if (button.dataset.mode !== currentMode) {
                setMode(button.dataset.mode);
            }
        });
    });

    // ==========================================
    // CHAT FORM
    // ==========================================

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const message = input.value.trim();

        if (!message) return;

        addMessage(message, "user");
        input.value = "";
        status.textContent = "Sending...";

        const submitButton = form.querySelector("button");
        submitButton.disabled = true;

        try {
            if (currentMode === "ai") {
                const result = await sendAIMessage(message);

                addMessage(result.reply, "bot");
                status.textContent = "AI Assistant is ready";

            } else {
                const result = await sendStaffMessage(message);

                if (result) {
                    status.textContent = "Message sent to support";
                } else {
                    addMessage(
                        "Your message could not be sent. Please try again.",
                        "bot"
                    );
                }
            }

        } catch (error) {
            addMessage(
                "Sorry, support is temporarily unavailable. Please try again later or call 09044019877.",
                "bot"
            );

            status.textContent = "Connection unavailable";
            console.error(error);

        } finally {
            submitButton.disabled = false;
            input.focus();
        }
    });

    // ==========================================
    // CLEAN UP
    // ==========================================

    window.addEventListener("beforeunload", stopStaffPolling);

})();
const STAFF_API = "http://127.0.0.1:5000";

const loginSection = document.getElementById("staffLogin");
const dashboardSection = document.getElementById("staffDashboard");

const loginForm = document.getElementById("staffLoginForm");
const loginMessage = document.getElementById("staffLoginMessage");

const logoutButton = document.getElementById("staffLogoutButton");
const conversationList = document.getElementById("conversationList");

const messagesArea = document.getElementById("staffMessages");
const conversationTitle = document.getElementById("selectedConversation");
const connectionStatus = document.getElementById("staffConnectionStatus");

const replyForm = document.getElementById("staffReplyForm");
const replyInput = document.getElementById("staffReplyInput");
const replyButton = document.getElementById("staffReplyButton");

let selectedConversationId = null;
let refreshTimer = null;
let lastMessageId = 0;
let csrfToken = null;


// API REQUEST HELPER
// GET CSRF TOKEN
async function getCsrfToken() {
    const response = await fetch(`${STAFF_API}/api/csrf-token`, {
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


// API REQUEST HELPER
async function staffRequest(endpoint, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    const headers = {
        "Content-Type": "application/json",
        ...options.headers
    };

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        headers["X-CSRFToken"] = await getCsrfToken();
    }

    const response = await fetch(`${STAFF_API}${endpoint}`, {
        ...options,
        method,
        credentials: "include",
        headers
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
        showLogin();
        throw new Error("Your staff session has expired.");
    }

    if (!response.ok) {
        throw new Error(result.message || "Something went wrong.");
    }

    return result;
}


// SAFE MESSAGE DISPLAY
function addStaffMessage(message, sender, messageId) {
    if (messageId && document.querySelector(
        `[data-message-id="${messageId}"]`
    )) {
        return;
    }

    const bubble = document.createElement("div");

    bubble.className = `staff-message staff-message-${sender}`;
    bubble.textContent = message;

    if (messageId) {
        bubble.dataset.messageId = messageId;
    }

    messagesArea.appendChild(bubble);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}


// SHOW LOGIN
function showLogin() {
    loginSection.hidden = false;
    dashboardSection.hidden = true;

    selectedConversationId = null;

    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }

    replyInput.disabled = true;
    replyButton.disabled = true;

    connectionStatus.textContent = "Not connected";
}


// SHOW DASHBOARD
function showDashboard() {
    loginSection.hidden = true;
    dashboardSection.hidden = false;

    connectionStatus.textContent = "Connected";

    loadConversations();

    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(() => {
        loadConversations();

        if (selectedConversationId) {
            loadConversation(selectedConversationId);
        }
    }, 5000);
}


// STAFF LOGIN
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = document.getElementById("staffUsername").value.trim();
    const password = document.getElementById("staffPassword").value;
    const loginButton = document.getElementById("staffLoginButton");

    loginButton.disabled = true;
    loginMessage.textContent = "Signing in...";

    try {
        await staffRequest("/api/staff/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        loginForm.reset();
        loginMessage.textContent = "";

        showDashboard();

    } catch (error) {
        loginMessage.textContent = error.message;

    } finally {
        loginButton.disabled = false;
    }
});


// LOAD CONVERSATIONS
async function loadConversations() {
    try {
        const result = await staffRequest(
            "/api/staff/conversations"
        );

        conversationList.replaceChildren();

        if (!result.conversations.length) {
            const empty = document.createElement("p");
            empty.textContent = "No conversations yet.";
            conversationList.appendChild(empty);
            return;
        }

        result.conversations.forEach((conversation) => {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "conversation-item";

            button.textContent =
                `Customer conversation ${conversation.conversation_id.slice(0, 8)}`;

            if (
                conversation.conversation_id === selectedConversationId
            ) {
                button.classList.add("active");
            }

            button.addEventListener("click", () => {
                openConversation(conversation.conversation_id);
            });

            conversationList.appendChild(button);
        });

    } catch (error) {
        console.error("Could not load conversations:", error);
    }
}


// OPEN CONVERSATION
async function openConversation(conversationId) {
    selectedConversationId = conversationId;
    lastMessageId = 0;

    conversationTitle.textContent =
        `Conversation ${conversationId.slice(0, 8)}`;

    messagesArea.replaceChildren();

    replyInput.disabled = false;
    replyButton.disabled = false;

    await loadConversation(conversationId);
    await loadConversations();
}


// LOAD MESSAGES
async function loadConversation(conversationId) {
    if (conversationId !== selectedConversationId) {
        return;
    }

    try {
        const result = await staffRequest(
            `/api/staff/conversations/${encodeURIComponent(conversationId)}`
        );

        result.messages.forEach((message) => {
            if (message.id > lastMessageId) {
                addStaffMessage(
                    message.message,
                    message.sender,
                    message.id
                );

                lastMessageId = message.id;
            }
        });

    } catch (error) {
        console.error("Could not load messages:", error);
    }
}


// SEND STAFF REPLY
replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedConversationId) {
        return;
    }

    const message = replyInput.value.trim();

    if (!message) {
        return;
    }

    replyButton.disabled = true;

    try {
        await staffRequest(
            `/api/staff/conversations/${encodeURIComponent(selectedConversationId)}/reply`,
            {
                method: "POST",
                body: JSON.stringify({ message })
            }
        );

        replyInput.value = "";

        await loadConversation(selectedConversationId);

    } catch (error) {
        alert(error.message);
    } finally {
        replyButton.disabled = false;
    }
});


// LOG OUT
logoutButton.addEventListener("click", async () => {
    try {
        await staffRequest("/api/staff/logout", {
            method: "POST"
        });
    } catch (error) {
        console.error("Logout error:", error);
    }

    showLogin();
});


// CHECK EXISTING SESSION
async function checkStaffSession() {
    try {
        await staffRequest("/api/staff/conversations");
        showDashboard();
    } catch (error) {
        showLogin();
    }
}

checkStaffSession();
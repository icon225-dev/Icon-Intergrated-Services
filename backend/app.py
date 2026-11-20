import os
import re
import json
import sqlite3
import uuid

from datetime import datetime, timezone

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect, generate_csrf
from dotenv import load_dotenv
from openai import OpenAI

from extensions import limiter
from staff import staff


# ==========================================
# 1. CONFIGURATION
# ==========================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

load_dotenv(os.path.join(BASE_DIR, ".env"))

app = Flask(__name__)

app.config.update(
    SECRET_KEY=os.getenv("FLASK_SECRET_KEY"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv(
        "COOKIE_SECURE", "false"
    ).lower() == "true"
)

if not app.config["SECRET_KEY"]:
    raise RuntimeError(
        "FLASK_SECRET_KEY is missing from backend/.env"
    )

csrf = CSRFProtect(app)
limiter.init_app(app)

DATABASE = os.path.join(BASE_DIR, "icon_database.db")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

FRONTEND_ORIGIN = os.getenv(
    "ICON_FRONTEND_ORIGIN",
    "http://127.0.0.1:5500"
)

CORS(
    app,
    origins=[FRONTEND_ORIGIN],
    supports_credentials=True
)

app.register_blueprint(staff)


# ==========================================
# 2. COMPANY INFORMATION
# ==========================================

COMPANY_INFO = """
You are the official AI assistant for ICON Integrated Services.

Company details:
- Established in 2005.
- Registration number: RC 615951.
- Location: Ikeja, Lagos, Nigeria.
- Services: Haulage, Logistics, Warehousing and Procurement.
- Phone: +2349044019877.
- Email: icon225@iconintergratedservices.org.

Be professional, friendly and concise.
Only answer questions about ICON and its services.
Never invent prices, delivery times, availability or quotations.
Direct customers to the booking or contact page when they need
a quotation, booking confirmation or human assistance.
"""


# ==========================================
# 3. GENERAL HELPERS
# ==========================================

def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def current_time():
    return datetime.now(timezone.utc).isoformat()


def clean_text(value, maximum=3000):
    if not isinstance(value, str):
        return ""
    return value.strip()[:maximum]


def valid_conversation_id(value):
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def valid_email(email):
    return bool(
        re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email)
    )


# ==========================================
# 4. DATABASE INITIALISATION
# ==========================================

def initialise_database():
    connection = get_db()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            company TEXT,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            service TEXT NOT NULL,
            pickup TEXT NOT NULL DEFAULT '',
            destination TEXT NOT NULL DEFAULT '',
            booking_date TEXT,
            quantity TEXT,
            message TEXT,
            created_at TEXT NOT NULL,
            service_details TEXT
        )
    """)

    # Add the new column to existing databases without
    # deleting previously submitted bookings.
    existing_columns = {
        row["name"]
        for row in connection.execute(
            "PRAGMA table_info(bookings)"
        ).fetchall()
    }

    if "service_details" not in existing_columns:
        connection.execute("""
            ALTER TABLE bookings
            ADD COLUMN service_details TEXT
        """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS contact_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT NOT NULL,
            subject TEXT,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS support_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            system_notice INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)

    connection.commit()
    connection.close()


# ==========================================
# 5. HOME AND CSRF
# ==========================================

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "online",
        "message": "ICON Integrated Services API is running."
    })


@app.route("/api/csrf-token", methods=["GET"])
def get_csrf_token():
    return jsonify({
        "csrf_token": generate_csrf()
    })


# ==========================================
# 6. BOOKING VALIDATION
# ==========================================

SERVICE_FIELDS = {
    "logistics": {
        "pickup": "Pickup address",
        "destination": "Delivery address"
    },
    "haulage": {
        "goodsType": "Type of goods"
    },
    "warehousing": {
        "storageGoods": "Goods to be stored"
    },
    "procurement": {
        "itemsRequired": "Items required"
    }
}


def validate_booking(data):
    required_general = {
        "fullName": "Full name",
        "email": "Email",
        "phone": "Phone number",
        "service": "Service",
        "date": "Preferred service date"
    }

    for field, label in required_general.items():
        if not clean_text(data.get(field)):
            return f"{label} is required."

    email = clean_text(data.get("email"), 254)

    if not valid_email(email):
        return "Please enter a valid email address."

    service = clean_text(data.get("service"), 100).lower()

    if service not in SERVICE_FIELDS:
        return "Please select a valid service."

    for field, label in SERVICE_FIELDS[service].items():
        if not clean_text(data.get(field)):
            return f"{label} is required."

    if data.get("consent") is not True:
        return "Please agree to the contact consent before submitting."

    return None


# ==========================================
# 7. BOOKING SUBMISSION
# ==========================================

@app.route("/api/bookings", methods=["POST"])
@limiter.limit("10 per hour")
def create_booking():
    data = request.get_json(silent=True) or {}

    error = validate_booking(data)

    if error:
        return jsonify({"message": error}), 400

    service = clean_text(data.get("service"), 100).lower()

    service_labels = {
        "logistics": "Logistics",
        "haulage": "Haulage",
        "warehousing": "Warehousing",
        "procurement": "Procurement"
    }

    # Collect only the details belonging to the selected service.
    service_details = {
        field: clean_text(data.get(field), 1000)
        for field in SERVICE_FIELDS[service]
    }

    optional_fields = {
        "deliveryType": 100,
        "goodsType": 300,
        "loadWeight": 100,
        "truckType": 100,
        "storageGoods": 300,
        "storageType": 100,
        "storageDuration": 100,
        "itemsRequired": 1000,
        "itemQuantity": 100,
        "specifications": 1000
    }

    for field, maximum in optional_fields.items():
        if field in data and data[field]:
            service_details[field] = clean_text(
                data[field], maximum
            )

    # The old database requires pickup and destination.
    # Keep those columns compatible while using service_details
    # for all service-specific information.
    pickup = service_details.get("pickup", "")
    destination = service_details.get("destination", "")

    connection = get_db()

    try:
        connection.execute("""
            INSERT INTO bookings (
                full_name,
                company,
                email,
                phone,
                service,
                pickup,
                destination,
                booking_date,
                quantity,
                message,
                created_at,
                service_details
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            clean_text(data.get("fullName"), 150),
            clean_text(data.get("company"), 150),
            clean_text(data.get("email"), 254),
            clean_text(data.get("phone"), 40),
            service_labels[service],
            pickup,
            destination,
            clean_text(data.get("date"), 30),
            clean_text(data.get("quantity"), 100),
            clean_text(data.get("message"), 2000),
            current_time(),
            json.dumps(service_details)
        ))

        connection.commit()

    except sqlite3.Error:
        connection.rollback()
        app.logger.exception("Booking database error")

        return jsonify({
            "message": "We couldn't save your booking. Please try again."
        }), 500

    finally:
        connection.close()

    return jsonify({
        "message": "Your booking request has been received successfully."
    }), 201


# ==========================================
# 8. CONTACT FORM
# ==========================================

@app.route("/api/contact", methods=["POST"])
@limiter.limit("10 per hour")
def create_contact_message():
    data = request.get_json(silent=True) or {}

    name = clean_text(data.get("name"), 150)
    email = clean_text(data.get("email"), 254)
    message = clean_text(data.get("message"), 3000)

    if not name or not email or not message:
        return jsonify({
            "message": "Name, email and message are required."
        }), 400

    if not valid_email(email):
        return jsonify({
            "message": "Please enter a valid email."
        }), 400

    if data.get("consent") is not True:
        return jsonify({
            "message": "Please agree to the contact consent."
        }), 400

    connection = get_db()

    try:
        connection.execute("""
            INSERT INTO contact_messages (
                name, phone, email, subject, message, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            name,
            clean_text(data.get("phone"), 40),
            email,
            clean_text(data.get("subject"), 200),
            message,
            current_time()
        ))

        connection.commit()

    except sqlite3.Error:
        connection.rollback()
        app.logger.exception("Contact database error")

        return jsonify({
            "message": "We couldn't save your message. Please try again."
        }), 500

    finally:
        connection.close()

    return jsonify({
        "message": "Your message has been received. Thank you."
    }), 201


# ==========================================
# 9. AI CHAT
# ==========================================

@app.route("/api/chat", methods=["POST"])
@limiter.limit("20 per hour")
def ai_chat():
    if client is None:
        return jsonify({
            "message": "The AI assistant is temporarily unavailable."
        }), 503

    data = request.get_json(silent=True) or {}

    conversation_id = clean_text(
        data.get("conversation_id"), 36
    )

    message = clean_text(data.get("message"), 2000)

    if not valid_conversation_id(conversation_id):
        return jsonify({
            "message": "Invalid conversation."
        }), 400

    if not message:
        return jsonify({
            "message": "Please enter a message."
        }), 400

    connection = get_db()

    connection.execute("""
        INSERT INTO chat_messages (
            conversation_id, sender, message, created_at
        )
        VALUES (?, 'customer', ?, ?)
    """, (conversation_id, message, current_time()))

    history = connection.execute("""
        SELECT sender, message
        FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY id DESC
        LIMIT 10
    """, (conversation_id,)).fetchall()

    connection.commit()
    connection.close()

    messages = [
        {"role": "system", "content": COMPANY_INFO}
    ]

    for item in reversed(history):
        role = (
            "assistant"
            if item["sender"] == "assistant"
            else "user"
        )

        messages.append({
            "role": role,
            "content": item["message"]
        })

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=300
        )

        reply = response.choices[0].message.content or ""
        reply = reply.strip()[:3000]

        connection = get_db()

        connection.execute("""
            INSERT INTO chat_messages (
                conversation_id, sender, message, created_at
            )
            VALUES (?, 'assistant', ?, ?)
        """, (conversation_id, reply, current_time()))

        connection.commit()
        connection.close()

        return jsonify({"reply": reply}), 200

    except Exception:
        app.logger.exception("AI chat request failed")

        return jsonify({
            "message": "The AI assistant is having trouble right now."
        }), 500


# ==========================================
# 10. CUSTOMER LIVE SUPPORT
# ==========================================

@app.route("/api/support/messages", methods=["POST"])
@limiter.limit("30 per hour")
def create_support_message():
    data = request.get_json(silent=True) or {}

    conversation_id = clean_text(
        data.get("conversation_id"), 36
    )

    message = clean_text(data.get("message"), 2000)
    system_notice = bool(data.get("system_notice", False))

    if not valid_conversation_id(conversation_id):
        return jsonify({
            "message": "Invalid conversation."
        }), 400

    if not message:
        return jsonify({
            "message": "Please enter a message."
        }), 400

    connection = get_db()

    connection.execute("""
        INSERT INTO support_messages (
            conversation_id,
            sender,
            message,
            system_notice,
            created_at
        )
        VALUES (?, 'customer', ?, ?, ?)
    """, (
        conversation_id,
        message,
        int(system_notice),
        current_time()
    ))

    connection.commit()
    connection.close()

    return jsonify({
        "message": "Your message has been sent to our support system."
    }), 201


@app.route(
    "/api/support/messages/<conversation_id>",
    methods=["GET"]
)
def get_support_replies(conversation_id):
    if not valid_conversation_id(conversation_id):
        return jsonify({
            "message": "Invalid conversation."
        }), 400

    connection = get_db()

    messages = connection.execute("""
        SELECT id, sender, message, system_notice, created_at
        FROM support_messages
        WHERE conversation_id = ?
        AND sender = 'staff'
        ORDER BY id ASC
    """, (conversation_id,)).fetchall()

    connection.close()

    return jsonify({
        "messages": [
            {
                "id": item["id"],
                "sender": item["sender"],
                "message": item["message"],
                "system_notice": bool(item["system_notice"])
                "created_at": item["created_at"]
            }
            for item in messages
        ]
    }), 200


# ==========================================
# 11. START APPLICATION
# ==========================================

initialise_database()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )
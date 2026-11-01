import os
import sqlite3
import secrets

from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, session
from werkzeug.security import check_password_hash

from extensions import limiter

staff = Blueprint("staff", __name__)

DATABASE = os.path.join(
    os.path.dirname(__file__),
    "icon_database.db"
)


def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def staff_required():
    return session.get("icon_staff_authenticated") is True


# STAFF LOGIN
@staff.route("/api/staff/login", methods=["POST"])
@limiter.limit("5 per 15 minutes")
def staff_login():
    data = request.get_json(silent=True) or {}

    username = data.get("username", "")
    password = data.get("password", "")

    correct_username = os.getenv("ICON_STAFF_USERNAME", "")
    password_hash = os.getenv("ICON_STAFF_PASSWORD_HASH", "")

    if not correct_username or not password_hash:
        return jsonify({
            "message": "Staff login has not been configured."
        }), 503

    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({
            "message": "Invalid login details."
        }), 400

    username_matches = secrets.compare_digest(
        username,
        correct_username
    )

    password_matches = check_password_hash(
        password_hash,
        password
    )

    if not username_matches or not password_matches:
        return jsonify({
            "message": "Incorrect username or password."
        }), 401

    session.clear()
    session["icon_staff_authenticated"] = True

    return jsonify({
        "message": "Staff login successful."
    }), 200


# STAFF LOGOUT
@staff.route("/api/staff/logout", methods=["POST"])
def staff_logout():
    session.clear()

    return jsonify({
        "message": "You have been logged out."
    }), 200


# VIEW ALL CUSTOMER CONVERSATIONS
@staff.route("/api/staff/conversations", methods=["GET"])
def staff_conversations():
    if not staff_required():
        return jsonify({
            "message": "Authentication required."
        }), 401

    connection = get_db()

    conversations = connection.execute("""
        SELECT
            conversation_id,
            MAX(created_at) AS last_message
        FROM support_messages
        GROUP BY conversation_id
        ORDER BY last_message DESC
    """).fetchall()

    connection.close()

    return jsonify({
        "conversations": [
            {
                "conversation_id": item["conversation_id"],
                "last_message": item["last_message"]
            }
            for item in conversations
        ]
    }), 200


# VIEW A CUSTOMER CONVERSATION
@staff.route(
    "/api/staff/conversations/<conversation_id>",
    methods=["GET"]
)
def staff_get_conversation(conversation_id):
    if not staff_required():
        return jsonify({
            "message": "Authentication required."
        }), 401

    connection = get_db()

    messages = connection.execute("""
        SELECT id, sender, message, system_notice, created_at
        FROM support_messages
        WHERE conversation_id = ?
        ORDER BY id ASC
    """, (conversation_id,)).fetchall()

    connection.close()

    return jsonify({
        "messages": [
            {
                "id": item["id"],
                "sender": item["sender"],
                "message": item["message"],
                "system_notice": bool(item["system_notice"]),
                "created_at": item["created_at"]
            }
            for item in messages
        ]
    }), 200


# REPLY TO A CUSTOMER
@staff.route(
    "/api/staff/conversations/<conversation_id>/reply",
    methods=["POST"]
)
def staff_reply(conversation_id):
    if not staff_required():
        return jsonify({
            "message": "Authentication required."
        }), 401

    data = request.get_json(silent=True) or {}
    message = data.get("message", "")

    if not isinstance(message, str):
        return jsonify({
            "message": "Invalid message."
        }), 400

    message = message.strip()[:2000]

    if not message:
        return jsonify({
            "message": "Please enter a reply."
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
        VALUES (?, 'staff', ?, 0, ?)
    """, (
        conversation_id,
        message,
        datetime.now(timezone.utc).isoformat()
    ))

    connection.commit()
    connection.close()

    return jsonify({
        "message": "Reply sent successfully."
    }), 201
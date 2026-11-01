import secrets
import getpass

from werkzeug.security import generate_password_hash

print("\nICON INTEGRATED SERVICES")
print("Staff Credential Generator\n")

username = input("Choose a staff username: ").strip()

if not username:
    raise SystemExit("Username cannot be empty.")

password = getpass.getpass("Create a staff password: ")
confirm = getpass.getpass("Confirm staff password: ")

if password != confirm:
    raise SystemExit("Passwords do not match.")

if len(password) < 12:
    raise SystemExit("Use a password with at least 12 characters.")

secret_key = secrets.token_urlsafe(48)
password_hash = generate_password_hash(password)

print("\nCredentials generated successfully.")
print("\nAdd these lines to your private backend/.env file:\n")

print(f"FLASK_SECRET_KEY={secret_key}")
print(f"ICON_STAFF_USERNAME={username}")
print(f"ICON_STAFF_PASSWORD_HASH={password_hash}")

print("\nKeep these values private.")
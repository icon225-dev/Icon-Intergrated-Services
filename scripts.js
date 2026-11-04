// ==========================================
// ICON INTEGRATED SERVICES
// Main Website JavaScript
// ==========================================

const API_BASE_URL = "http://icon-intergrated-backend.onrender.com";

let csrfToken = null;


// ==========================================
// 1. CSRF SECURITY
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
// 2. MOBILE NAVIGATION
// Supports both existing and new HTML IDs
// ==========================================

const menuToggle =
    document.getElementById("menuToggle") ||
    document.querySelector(".menu-toggle");

const navbar =
    document.getElementById("navbar") ||
    document.querySelector(".nav-menu");

if (menuToggle && navbar) {
    menuToggle.setAttribute("aria-expanded", "false");

    menuToggle.addEventListener("click", () => {
        const isOpen = navbar.classList.toggle("open");
        menuToggle.setAttribute("aria-expanded", String(isOpen));
    });

    navbar.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            navbar.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
        });
    });

    document.addEventListener("click", event => {
        if (
            !navbar.contains(event.target) &&
            !menuToggle.contains(event.target)
        ) {
            navbar.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            navbar.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
        }
    });
}


// ==========================================
// 3. COPYRIGHT YEAR
// ==========================================

const currentYear = document.getElementById("currentYear");

if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
}


// ==========================================
// 4. VEHICLE FILTERS
// ==========================================

const filterButtons = document.querySelectorAll(".filter-btn");
const vehicleCards = document.querySelectorAll(".vehicle-card");

if (filterButtons.length && vehicleCards.length) {
    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            const selectedCategory = button.dataset.filter;

            filterButtons.forEach(filter => {
                filter.classList.remove("active");
            });

            button.classList.add("active");

            vehicleCards.forEach(card => {
                const matches =
                    selectedCategory === "all" ||
                    card.dataset.category === selectedCategory;

                card.hidden = !matches;
            });
        });
    });
}


// ==========================================
// 5. BOOKING FORM
// ==========================================

const bookingForm = document.getElementById("bookingForm");
const bookingMessage = document.getElementById("bookingMessage");

if (bookingForm) {
    const serviceSelect = bookingForm.querySelector('[name="service"]');
    const dateInput = bookingForm.querySelector('[name="date"]');

    // Set today's date as the earliest booking date.
    if (dateInput) {
        const today = new Date();

        dateInput.min = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");
    }

    // Automatically select services linked from the services page.
    if (serviceSelect) {
        const parameters = new URLSearchParams(window.location.search);
        const requestedService = parameters.get("service");

        if (requestedService) {
            const matchingOption = Array.from(serviceSelect.options).find(
                option =>
                    option.value.toLowerCase() === requestedService.toLowerCase()
            );

            if (matchingOption) {
                serviceSelect.value = matchingOption.value;

                serviceSelect.dispatchEvent(
                    new Event("change", { bubbles: true })
                );
            }
        }
    }

    bookingForm.addEventListener("submit", async event => {
        event.preventDefault();

        if (!bookingForm.reportValidity()) {
            return;
        }

        const submitButton = bookingForm.querySelector('[type="submit"]');
        const originalButtonText = submitButton?.textContent || "Submit Booking";

        // Disabled fields are excluded, so only the selected service's
        // relevant details are included.
        const formData = new FormData(bookingForm);
        const bookingData = Object.fromEntries(formData.entries());

        bookingData.consent = bookingForm.querySelector(
            '[name="consent"]'
        )?.checked || false;

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Submitting...";
        }

        if (bookingMessage) {
            bookingMessage.textContent = "Submitting your booking request...";
            bookingMessage.className = "form-message";
        }

        try {
            const token = await getCsrfToken();

            const response = await fetch(`${API_BASE_URL}/api/bookings`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": token
                },
                body: JSON.stringify(bookingData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Unable to submit your booking."
                );
            }

            if (bookingMessage) {
                bookingMessage.textContent =
                    result.message ||
                    "Thank you! Your booking enquiry has been received.";

                bookingMessage.className = "form-message success";
            }

            bookingForm.reset();

            // Hide service-specific sections after resetting.
            if (serviceSelect) {
                serviceSelect.dispatchEvent(
                    new Event("change", { bubbles: true })
                );
            }

        } catch (error) {
            console.error("Booking submission error:", error);

            if (bookingMessage) {
                bookingMessage.textContent =
                    error.message ||
                    "We couldn't submit your booking. Please try again.";

                bookingMessage.className = "form-message error";
            }

        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        }
    });
}


// ==========================================
// 6. CONTACT FORM
// ==========================================

const contactForm = document.getElementById("contactForm");

const contactMessageStatus = document.getElementById(
    "contactMessageStatus"
);

if (contactForm) {
    contactForm.addEventListener("submit", async event => {
        event.preventDefault();

        if (!contactForm.reportValidity()) {
            return;
        }

        const submitButton = contactForm.querySelector('[type="submit"]');
        const originalButtonText = submitButton?.textContent || "Send Message";

        const formData = new FormData(contactForm);
        const contactData = Object.fromEntries(formData.entries());

        contactData.consent = contactForm.querySelector(
            '[name="consent"]'
        )?.checked || false;

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Sending...";
        }

        if (contactMessageStatus) {
            contactMessageStatus.textContent = "Sending your message...";
            contactMessageStatus.className = "form-message";
        }

        try {
            const token = await getCsrfToken();

            const response = await fetch(`${API_BASE_URL}/api/contact`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": token
                },
                body: JSON.stringify(contactData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Unable to send your message."
                );
            }

            if (contactMessageStatus) {
                contactMessageStatus.textContent =
                    result.message || "Your message was sent successfully.";

                contactMessageStatus.className = "form-message success";
            }

            contactForm.reset();

        } catch (error) {
            console.error("Contact form error:", error);

            if (contactMessageStatus) {
                contactMessageStatus.textContent =
                    error.message ||
                    "We couldn't send your message. Please try again.";

                contactMessageStatus.className = "form-message error";
            }

        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        }
    });
}
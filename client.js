/* ==========================================================================
   ApexFit | Client Portal
   ========================================================================== */

const SUPABASE_URL = "https://ondobvmvduqoaezqddxe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pwDCukl5Rfvo8FRKZr-hXQ_ITdBvUPI";

const $ = (selector) => document.querySelector(selector);

let db;
let user;
let customer;
let currentSection = "dashboard";

const PAGE_TITLES = {
  dashboard: "Dashboard",
  profile: "My Profile",
  plans: "Membership Plans",
  orders: "My Orders",
  tickets: "Support Tickets",
};

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

// Escape text before putting it inside HTML.
const esc = (value) =>
  String(value ?? "—").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

// Format a number as Philippine pesos, e.g. ₱1,500.00
function formatPeso(amount) {
  return "₱" + Number(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function message(text, error = true) {
  $("#loginMessage").textContent = text;
  $("#loginMessage").style.color = error ? "#b44b39" : "#1c2f9a";
}

function notify(text) {
  const el = $("#toast");

  el.textContent = text;
  el.classList.add("show");

  setTimeout(() => el.classList.remove("show"), 2500);
}

/* --------------------------------------------------------------------------
   Startup
   -------------------------------------------------------------------------- */

async function init() {
  if (!window.supabase?.createClient) {
    message("Supabase could not load. Check your internet connection.");
    return;
  }

  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  $("#loginForm").addEventListener("submit", signIn);
  $("#logout").addEventListener("click", signOut);

  // Mobile menu button.
  $("#menu").addEventListener("click", () => {
    $("#clientSidebar").classList.toggle("open");
  });

  // Sidebar navigation.
  $("#clientNav").addEventListener("click", (e) => {
    const button = e.target.closest("[data-section]");

    if (button) showSection(button.dataset.section);
  });

  // Close the mobile sidebar when tapping outside of it.
  document.addEventListener("click", (e) => {
    const sidebar = $("#clientSidebar");
    const clickedOutside =
      !sidebar.contains(e.target) && !$("#menu").contains(e.target);

    if (window.innerWidth <= 800 && clickedOutside) {
      sidebar.classList.remove("open");
    }
  });

  // Restore an existing session, if any.
  const { data: { session } } = await db.auth.getSession();

  if (session) await enter(session.user);
}

/* --------------------------------------------------------------------------
   Sign in / sign out
   -------------------------------------------------------------------------- */

async function signIn(e) {
  e.preventDefault();

  const button = $("#loginForm button[type=submit]");

  button.disabled = true;
  button.textContent = "Signing in…";
  document.querySelector("#loadingOverlay")?.classList.add("active");
  document.querySelector("#loadingOverlay")?.setAttribute("aria-hidden", "false");
  message("");

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value,
    });

    if (error) throw error;

    await enter(data.user);
  } catch (err) {
    message(err.message || "Sign-in failed.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
    document.querySelector("#loadingOverlay")?.classList.remove("active");
    document.querySelector("#loadingOverlay")?.setAttribute("aria-hidden", "true");
  }
}

async function enter(signedInUser) {
  user = signedInUser;

  const { data, error } = await db
    .from("customers")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    await db.auth.signOut();
    message("Could not load your client profile: " + error.message);
    return;
  }

  if (!data) {
    await db.auth.signOut();
    message(
      "No customer record is linked to this account. " +
      "Please ask ApexFit staff to link your account."
    );
    return;
  }

  customer = data;

  $("#loginScreen").classList.add("hidden");
  $("#clientApp").classList.remove("hidden");

  await showSection("dashboard");
}

async function signOut() {
  if (db) await db.auth.signOut();

  user = null;
  customer = null;

  $("#clientApp").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  $("#loginForm").reset();
  $("#clientSidebar").classList.remove("open");
}

/* --------------------------------------------------------------------------
   Sections
   -------------------------------------------------------------------------- */

// Sections that load a list from Supabase.
const LIST_SECTIONS = {
  plans: {
    table: "membership_plans",
    title: "Available membership plans",
    empty: "No membership plans are available.",
    render: (r) => `
      <div class="client-item">
        <b>${esc(r.name || "Membership plan")}</b>
        <span>
          ${r.price == null ? "Price not listed" : formatPeso(r.price)}
          ${r.duration_months ? ` · ${esc(r.duration_months)} month(s)` : ""}
        </span>
      </div>`,
  },

  orders: {
    table: "orders",
    title: "My orders",
    empty: "You don't have any orders yet.",
    render: (r) => `
      <div class="client-item">
        <b>Order ${esc(String(r.id || "").slice(0, 8) || "record")}</b>
        <span>
          ${r.amount == null ? "Amount not listed" : "Amount: " + formatPeso(r.amount)}
          ${r.order_date ? " · Date: " + esc(r.order_date) : ""}
        </span>
      </div>`,
  },

  tickets: {
    table: "tickets",
    title: "My support tickets",
    empty: "You don't have any support tickets yet.",
    render: (r) => `
      <div class="client-item">
        <b>${esc(r.subject || "Support request")}</b>
        <span>
          ${esc(r.status || "Status not set")}
          ${r.opened_at
            ? " · Opened: " + esc(new Date(r.opened_at).toLocaleDateString("en-PH"))
            : ""}
        </span>
      </div>`,
  },
};

function renderDashboard(content) {
  content.innerHTML = `
    <div class="intro">
      <div>
        <p class="eyebrow">MEMBER PORTAL</p>
        <h1>Welcome, ${esc(customer.full_name || user.email)}.</h1>
      </div>
      <span class="connected">● Client account</span>
    </div>

    <div class="client-grid">
      <button class="panel client-link" data-go="profile">
        <p class="eyebrow">ACCOUNT</p>
        <h3>My Profile</h3>
        <p class="muted">View your personal details and status.</p>
      </button>

      <button class="panel client-link" data-go="plans">
        <p class="eyebrow">MEMBERSHIPS</p>
        <h3>Membership Plans</h3>
        <p class="muted">Browse available gym plans.</p>
      </button>

      <button class="panel client-link" data-go="orders">
        <p class="eyebrow">PURCHASES</p>
        <h3>My Orders</h3>
        <p class="muted">View your order history.</p>
      </button>

      <button class="panel client-link" data-go="tickets">
        <p class="eyebrow">HELP</p>
        <h3>Support Tickets</h3>
        <p class="muted">View your support requests.</p>
      </button>
    </div>`;

  content.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.go));
  });
}

function renderProfile(content) {
  content.innerHTML = `
    <div class="intro">
      <div>
        <p class="eyebrow">ACCOUNT DETAILS</p>
        <h1>My Profile</h1>
      </div>
    </div>

    <article class="panel">
      <p class="client-detail"><b>Full name</b><span>${esc(customer.full_name)}</span></p>
      <p class="client-detail"><b>Email</b><span>${esc(customer.email || user.email)}</span></p>
      <p class="client-detail"><b>Phone</b><span>${esc(customer.phone || "Not provided")}</span></p>
      <p class="client-detail"><b>Status</b><span>${esc(customer.status || "—")}</span></p>
      <p class="client-detail"><b>Joined</b><span>${esc(customer.joined_on || "—")}</span></p>
    </article>`;
}

async function renderList(content, section) {
  const config = LIST_SECTIONS[section];
  const query = db.from(config.table).select("*");

  // Membership plans are shared; orders and tickets belong to this customer.
  const result = section === "plans"
    ? await query.limit(100)
    : await query.eq("customer_id", customer.id).limit(100);

  let body;

  if (result.error) {
    body = `<p class="client-error">Could not load this section: ${esc(result.error.message)}</p>`;
  } else if (result.data?.length) {
    body = result.data.map(config.render).join("");
  } else {
    body = `<p class="muted">${esc(config.empty)}</p>`;
  }

  content.innerHTML = `
    <div class="intro">
      <div>
        <p class="eyebrow">MY APEXFIT</p>
        <h1>${esc(config.title)}</h1>
      </div>
    </div>

    <article class="panel">${body}</article>`;
}

async function showSection(section) {
  currentSection = section;

  const title = PAGE_TITLES[section] || PAGE_TITLES.dashboard;
  const content = $("#clientContent");

  $("#pageTitle").textContent = title;

  document.querySelectorAll("#clientNav [data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
  });

  $("#clientSidebar").classList.remove("open");

  // Temporary loading state.
  content.innerHTML = `
    <div class="intro">
      <div>
        <p class="eyebrow">MY APEXFIT</p>
        <h1>${esc(title)}</h1>
        <p class="muted">Your account information in one place.</p>
      </div>
      <span class="connected">● Client account</span>
    </div>

    <article class="panel"><p class="muted">Loading…</p></article>`;

  if (section === "dashboard") return renderDashboard(content);
  if (section === "profile") return renderProfile(content);

  await renderList(content, section);
}

document.addEventListener("DOMContentLoaded", init);

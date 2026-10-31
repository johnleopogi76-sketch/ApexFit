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

const esc = (value) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char])
  );

function formatPeso(amount) {
  return (
    "₱" +
    Number(amount).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
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

async function init() {
  if (!window.supabase?.createClient) {
    message("Supabase could not load. Check your internet connection.");
    return;
  }

  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  $("#loginForm").addEventListener("submit", signIn);
  $("#registerForm").addEventListener("submit", registerCustomer);
  $("#showRegister").addEventListener("click", () => toggleAuthForm(true));
  $("#showLogin").addEventListener("click", () => toggleAuthForm(false));
  $("#logout").addEventListener("click", signOut);

  $("#menu").addEventListener("click", () => {
    $("#clientSidebar").classList.toggle("open");
  });

  $("#clientNav").addEventListener("click", (e) => {
    const button = e.target.closest("[data-section]");

    if (button) showSection(button.dataset.section);
  });

  document.addEventListener("click", (e) => {
    const sidebar = $("#clientSidebar");
    const clickedOutside =
      !sidebar.contains(e.target) && !$("#menu").contains(e.target);

    if (window.innerWidth <= 800 && clickedOutside) {
      sidebar.classList.remove("open");
    }
  });

  const {
    data: { session },
  } = await db.auth.getSession();

  if (session) await enter(session.user);
}

function toggleAuthForm(showRegister) {
  $("#loginForm").classList.toggle("hidden", showRegister);
  $("#registerForm").classList.toggle("hidden", !showRegister);
  $("#showRegister").classList.toggle("hidden", showRegister);
  $("#showLogin").classList.toggle("hidden", !showRegister);
  $(".login-card .eyebrow").textContent = showRegister
    ? "CREATE YOUR ACCOUNT"
    : "CLIENT SIGN IN";
  $(".login-card h2").textContent = showRegister
    ? "Join ApexFitness"
    : "Welcome back";
  $(".login-card > .muted").textContent = showRegister
    ? "Register once to access your client portal anytime."
    : "Sign in with your registered client account.";
  $("#loginMessage").textContent = "";
  $("#registerMessage").textContent = "";
}

async function registerCustomer(e) {
  e.preventDefault();
  if (!db) return;

  const button = $("#registerForm button[type=submit]");
  const fullName = $("#registerName").value.trim();
  const phone = $("#registerPhone").value.trim();
  const email = $("#registerEmail").value.trim().toLowerCase();
  const password = $("#registerPassword").value;

  if (!fullName) {
    $("#registerMessage").textContent = "Please enter your full name.";
    return;
  }
  if (password.length < 8) {
    $("#registerMessage").textContent =
      "Your password must be at least 8 characters.";
    return;
  }

  button.disabled = true;
  button.textContent = "Creating account…";
  $("#registerMessage").textContent = "";
  document.querySelector("#loadingOverlay")?.classList.add("active");
  document
    .querySelector("#loadingOverlay")
    ?.setAttribute("aria-hidden", "false");

  try {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) throw error;

    if (data.session && data.user) {
      await enter(data.user);
      return;
    }

    $("#registerMessage").style.color = "#1c2f9a";
    $("#registerMessage").textContent =
      "Account created. Check your email to confirm your address, then return here and sign in.";
    $("#registerForm").reset();
  } catch (err) {
    const msg = err.message || "Registration failed. Please try again.";
    $("#registerMessage").style.color = "#b44b39";
    $("#registerMessage").textContent = msg;
  } finally {
    button.disabled = false;
    button.textContent = "Create customer account";
    document.querySelector("#loadingOverlay")?.classList.remove("active");
    document
      .querySelector("#loadingOverlay")
      ?.setAttribute("aria-hidden", "true");
  }
}

async function signIn(e) {
  e.preventDefault();

  const button = $("#loginForm button[type=submit]");

  button.disabled = true;
  button.textContent = "Signing in…";
  document.querySelector("#loadingOverlay")?.classList.add("active");
  document
    .querySelector("#loadingOverlay")
    ?.setAttribute("aria-hidden", "false");
  message("");

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value,
    });

    if (error) throw error;

    await enter(data.user);
  } catch (err) {
    const msg = err.message || "Sign-in failed.";

    if (msg.toLowerCase().includes("invalid login credentials")) {
      message("Wrong email or password. Please try again.");
    } else {
      message(msg);
    }
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
    document.querySelector("#loadingOverlay")?.classList.remove("active");
    document
      .querySelector("#loadingOverlay")
      ?.setAttribute("aria-hidden", "true");
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
        "Please ask ApexFitness staff to link your account."
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

const LIST_SECTIONS = {
  plans: {
    table: "membership_plans",
    title: "Available membership plans",
    empty: "No membership plans are available.",
    render: (r) => ` <div class="client-item"> <b>${esc(r.name || "Membership plan")}</b> <span> ${r.price == null ? "Price not listed" : formatPeso(r.price)} ${r.duration_months ? ` · ${esc(r.duration_months)} month(s)` : ""} </span> </div>`,
  },

  orders: {
    table: "orders",
    title: "My orders",
    empty: "You don't have any orders yet.",
    render: (r) => ` <div class="client-item"> <b>Order ${esc(String(r.id || "").slice(0, 8) || "record")}</b> <span> ${ r.amount == null ? "Amount not listed" : "Amount: " + formatPeso(r.amount) } ${r.order_date ? " · Date: " + esc(r.order_date) : ""} </span> </div>`,
  },

  tickets: {
    table: "tickets",
    title: "My support tickets",
    empty: "You don't have any support tickets yet.",
    render: (r) => ` <div class="client-item"> <b>${esc(r.subject || "Support request")}</b> <span> ${esc(r.status || "Status not set")} ${ r.opened_at ? " · Opened: " + esc(new Date(r.opened_at).toLocaleDateString("en-PH")) : "" } </span> </div>`,
  },
};

function renderDashboard(content) {
  content.innerHTML = ` <div class="intro"> <div> <h1>Welcome, ${esc(customer.full_name || user.email)}.</h1> </div> </div> <div class="client-grid"> <button class="panel client-link" data-go="profile"> <p class="eyebrow">ACCOUNT</p> <h3>My Profile</h3> <p class="muted">View your personal details and status.</p> </button> <button class="panel client-link" data-go="plans"> <p class="eyebrow">MEMBERSHIPS</p> <h3>Membership Plans</h3> <p class="muted">Browse available gym plans.</p> </button> <button class="panel client-link" data-go="orders"> <p class="eyebrow">PURCHASES</p> <h3>My Orders</h3> <p class="muted">View your order history.</p> </button> <button class="panel client-link" data-go="tickets"> <p class="eyebrow">HELP</p> <h3>Support Tickets</h3> <p class="muted">View your support requests.</p> </button> </div>`;

  content.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.go));
  });
}

function renderProfile(content) {
  content.innerHTML = ` <div class="intro"> <div> <p class="eyebrow">ACCOUNT DETAILS</p> <h1>My Profile</h1> </div> </div> <article class="panel"> <p class="client-detail"><b>Full name</b><span>${esc( customer.full_name )}</span></p> <p class="client-detail"><b>Email</b><span>${esc( customer.email || user.email )}</span></p> <p class="client-detail"><b>Phone</b><span>${esc( customer.phone || "Not provided" )}</span></p> <p class="client-detail"><b>Status</b><span>${esc( customer.status || "—" )}</span></p> <p class="client-detail"><b>Joined</b><span>${esc( customer.joined_on || "—" )}</span></p> </article>`;
}

async function renderList(content, section) {
  const config = LIST_SECTIONS[section];
  const query = db.from(config.table).select("*");

  const result =
    section === "plans"
      ? await query.limit(100)
      : await query.eq("customer_id", customer.id).limit(100);

  let body;

  if (result.error) {
    body = `<p class="client-error">Could not load this section: ${esc( result.error.message )}</p>`;
  } else if (result.data?.length) {
    body = result.data.map(config.render).join("");
  } else {
    body = `<p class="muted">${esc(config.empty)}</p>`;
  }

  content.innerHTML = ` <div class="intro"> <div> <p class="eyebrow">MY APEXFITNESS</p> <h1>${esc(config.title)}</h1> </div> </div> <article class="panel">${body}</article>`;
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

  content.innerHTML = ` <div class="intro"> <div> <p class="eyebrow">MY APEXFITNESS</p> <h1>${esc(title)}</h1> <p class="muted">Your account information in one place.</p> </div> </div> <article class="panel"><p class="muted">Loading…</p></article>`;

  if (section === "dashboard") return renderDashboard(content);
  if (section === "profile") return renderProfile(content);

  await renderList(content, section);
}

document.addEventListener("DOMContentLoaded", init);

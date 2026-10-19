
const SUPABASE_URL = "https://ondobvmvduqoaezqddxe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pwDCukl5Rfvo8FRKZr-hXQ_ITdBvUPI";

const TABLES = {
  customers: ["Customers", "Customer records and member details."],
  membership_plans: ["Membership plans", "Membership options and pricing."],
  opportunities: ["Opportunities", "Potential sales and follow-up progress."],
  orders: ["Orders", "Membership orders and sales."],
  tickets: ["Support tickets", "Customer concerns and service requests."],
  interactions: ["Interactions", "Customer conversations and follow-ups."],
  users: ["User accounts", "View registered accounts. Editing is disabled in this starter."],
};

const $ = (s) => document.querySelector(s);

let db, user, profile;
let view = "dashboard";
let rows = [], columns = [], editing = null;
let toastTimer;
let editorOptions = {};
let displayMaps = {};

function notify(text, error = false) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("error", error);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

function message(text, error = true) {
  $("#loginMessage").textContent = text;
  $("#loginMessage").style.color = error ? "#b44b39" : "#1c2f9a";
}

function errText(e) {
  return e?.message || "Something went wrong. Please try again.";
}

function safe(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function esc(v) {
  return String(v ?? "—").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]
  );
}

function admin() {
  return profile?.role === "Admin";
}

function staffOrAdmin() {
  return ["Admin", "Staff"].includes(profile?.role);
}

function isClient() {
  return profile?.role === "Client";
}

function setupClient() {
  if (!window.supabase?.createClient) {
    message("Supabase client did not load. Check your connection.");
    return false;
  }

  if (
    SUPABASE_URL.startsWith("YOUR_") ||
    SUPABASE_ANON_KEY.startsWith("YOUR_")
  ) {
    message("Add your Supabase Project URL and key in app.js.");
    return false;
  }

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );

  return true;
}

async function loadProfile(signedInUser) {
  const { data: employee, error: employeeError } = await db
    .from("users")
    .select("*")
    .eq("id", signedInUser.id)
    .maybeSingle();

  if (employeeError) throw employeeError;

  if (employee && ["Admin", "Staff"].includes(employee.role)) {
    profile = employee;
    return;
  }

  const { data: customer, error: customerError } = await db
    .from("customers")
    .select("*")
    .eq("auth_user_id", signedInUser.id)
    .maybeSingle();

  if (customerError) throw customerError;

  if (!customer) {
    throw new Error(
      "No Admin/Staff profile or linked customer record was found for this account. Ask gym staff to link your account."
    );
  }

  profile = {
    role: "Client",
    full_name: customer.full_name || signedInUser.email,
    customer_id: customer.id,
    customer,
  };
}

/*
 * Admin and Staff can use this workspace.
 * Customers must sign in through client.html.
 */
async function enterApp(signedInUser) {
  user = signedInUser;

  await loadProfile(user);

  // Block customer accounts from the Admin/Staff workspace.
  if (isClient()) {
    await db.auth.signOut();
    user = null;
    profile = null;

    throw new Error(
      "This is a customer account. Please sign in through the Client Portal."
    );
  }

  // Block any account that is not Admin or Staff.
  if (!staffOrAdmin()) {
    await db.auth.signOut();
    user = null;
    profile = null;

    throw new Error(
      "You are not authorized to access the Admin/Staff workspace."
    );
  }

  $("#loginScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");

  $("#clientPortal").classList.add("hidden");
  $("#sidebar").classList.remove("client-mode");
  $("#dashboard").classList.remove("hidden");
  $("#records").classList.remove("hidden");

  await dashboard();
  await navigate(view);
}

/*
 * Load readable labels for related records.
 * Original UUIDs remain unchanged for database relationships.
 */
async function loadDisplayMaps() {
  displayMaps = {};

  const lookups = [
    ["customers", "full_name"],
    ["membership_plans", "name"],
    ["users", "full_name"],
    ["tickets", "subject"],
    ["opportunities", "stage"],
  ];

  await Promise.all(
    lookups.map(async ([table, labelColumn]) => {
      const { data, error } = await db
        .from(table)
        .select(`id, display_code, ${labelColumn}`)
        .limit(500);

      if (error) {
        console.warn(
          `Could not load ${table} display names:`,
          error.message
        );
        return;
      }

      displayMaps[table] = Object.fromEntries(
        (data || []).map(row => {
          const code = row.display_code || String(row.id).slice(0, 8);
          const label = row[labelColumn];

          return [
            String(row.id),
            label ? `${code} — ${label}` : code
          ];
        })
      );
    })
  );
}

function displayCell(column, value, row = null) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (column === "id" && row) {
    return row.display_code || `${String(value).slice(0, 8)}…`;
  }

  if (column === "display_code") {
    return value;
  }

  const relations = {
    customer_id: "customers",
    plan_id: "membership_plans",
    owner_id: "users",
    assigned_to: "users",
    user_id: "users",
    ticket_id: "tickets",
    opportunity_id: "opportunities",
  };

  const relationTable = relations[column];

  if (relationTable) {
    const label = displayMaps[relationTable]?.[String(value)];
    if (label) return label;
  }

  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
  ) {
    return value.slice(0, 8) + "…";
  }

  return safe(value);
}

/*
 * This function remains for compatibility with the existing project.
 * The Admin/Staff page no longer calls it for customer accounts.
 */
async function renderClientPortal() {
  const customer = profile.customer;

  $("#clientPortal").classList.remove("hidden");

  $("#clientPortal").innerHTML = `
    <div class="intro">
      <div>
        <p class="eyebrow">MEMBER PORTAL</p>
        <h1>Welcome, ${esc(customer.full_name || user.email)}.</h1>
        <p class="muted">Your ApexFit information in one place.</p>
      </div>
      <span class="connected">● Client account</span>
    </div>

    <div class="client-grid">
      <article class="panel">
        <p class="eyebrow">MY PROFILE</p>
        <h3>${esc(customer.full_name || "ApexFit Client")}</h3>
        <p class="client-detail"><b>Email</b><span>${esc(customer.email || user.email)}</span></p>
        <p class="client-detail"><b>Phone</b><span>${esc(customer.phone || "Not provided")}</span></p>
        <p class="client-detail"><b>Status</b><span>${esc(customer.status || "—")}</span></p>
      </article>

      <article class="panel">
        <p class="eyebrow">MEMBERSHIP OPTIONS</p>
        <h3>Available plans</h3>
        <div id="clientPlans" class="client-list"><p class="muted">Loading plans…</p></div>
      </article>

      <article class="panel">
        <p class="eyebrow">MY ORDERS</p>
        <h3>Orders and purchases</h3>
        <div id="clientOrders" class="client-list"><p class="muted">Loading orders…</p></div>
      </article>

      <article class="panel">
        <p class="eyebrow">SUPPORT</p>
        <h3>My support tickets</h3>
        <div id="clientTickets" class="client-list"><p class="muted">Loading tickets…</p></div>
      </article>
    </div>

    <p class="footnote">
      You can view only the customer record linked to your signed-in account.
      Contact ApexFit staff for changes or new orders.
    </p>
  `;

  const [plansResult, ordersResult, ticketsResult] = await Promise.all([
    db.from("membership_plans").select("*").limit(100),
    db.from("orders").select("*").eq("customer_id", customer.id).limit(100),
    db.from("tickets").select("*").eq("customer_id", customer.id).limit(100),
  ]);

  renderClientList(
    "clientPlans",
    plansResult,
    row => `
      <div class="client-item">
        <b>${esc(row.name || "Membership plan")}</b>
        <span>
          ${row.price == null
            ? "Price not listed"
            : "₱" + Number(row.price).toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
          ${row.duration_months ? ` · ${esc(row.duration_months)} month(s)` : ""}
        </span>
      </div>
    `,
    "No membership plans are available."
  );

  renderClientList(
    "clientOrders",
    ordersResult,
    row => `
      <div class="client-item">
        <b>Order ${esc(row.display_code || String(row.id || "").slice(0, 8) || "record")}</b>
        <span>
          ${row.amount == null
            ? "Amount not listed"
            : `Amount: ₱${Number(row.amount).toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}`}
          ${row.order_date ? ` · Date: ${esc(row.order_date)}` : ""}
        </span>
      </div>
    `,
    "You don't have any orders yet."
  );

  renderClientList(
    "clientTickets",
    ticketsResult,
    row => `
      <div class="client-item">
        <b>${esc(row.subject || "Support request")}</b>
        <span>
          ${esc(row.status || "Status not set")}
          ${row.opened_at
            ? ` · Opened: ${esc(new Date(row.opened_at).toLocaleDateString("en-PH"))}`
            : ""}
        </span>
      </div>
    `,
    "You don't have any support tickets."
  );
}

function renderClientList(id, result, render, emptyText) {
  const el = document.getElementById(id);
  if (!el) return;

  if (result.error) {
    el.innerHTML = `<p class="client-error">Could not load this section: ${esc(result.error.message)}</p>`;
    return;
  }

  const data = result.data || [];

  el.innerHTML = data.length
    ? data.map(render).join("")
    : `<p class="muted">${esc(emptyText)}</p>`;
}

async function signOut() {
  if (db) await db.auth.signOut();

  user = profile = null;

  $("#app").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  $("#loginForm").reset();
  $("#clientPortal").classList.add("hidden");
  $("#sidebar").classList.remove("client-mode");
}

async function dashboard() {
  if (!db || !user) return;

  const list = [
    ["customers", "Customers"],
    ["opportunities", "Opportunities"],
    ["orders", "Orders"],
    ["tickets", "Tickets"],
  ];

  const results = await Promise.all(
    list.map(async ([table, label]) => {
      const { count, error } = await db
        .from(table)
        .select("*", { count: "exact", head: true });

      return { label, count, error };
    })
  );

  $("#stats").innerHTML = results.map(x => `
    <article class="stat">
      <small>${esc(x.label)}</small>
      <b>${x.error ? "—" : x.count}</b>
    </article>
  `).join("");
}

async function navigate(next) {
  view = next;

  if (isClient()) return;

  $("#clientPortal").classList.add("hidden");
  $("#sidebar").classList.remove("open");

  document.querySelectorAll("#nav [data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  $("#dashboard").classList.toggle("hidden", view !== "dashboard");
  $("#records").classList.toggle("hidden", view === "dashboard");

  $("#pageTitle").textContent =
    view === "dashboard" ? "Overview" : TABLES[view]?.[0] || view;

  if (view === "dashboard") {
    $("#addBtn").classList.add("hidden");
    await dashboard();
    return;
  }

  if (!TABLES[view]) return;

  $("#recordsTitle").textContent = TABLES[view][0];
  $("#recordsDesc").textContent = TABLES[view][1];

  $("#addBtn").classList.toggle(
    "hidden",
    view === "users" || !staffOrAdmin()
  );

  $("#search").value = "";
  await loadTable();
}

async function loadTable() {
  const { data, error } = await db.from(view).select("*").limit(500);

  if (error) {
    rows = [];
    columns = [];

    $("#thead").innerHTML = "";
    $("#tbody").innerHTML = "";
    $("#empty").classList.remove("hidden");
    $("#empty h3").textContent = "Could not load records";
    $("#empty p").textContent = errText(error);
    $("#count").textContent = "Access issue";

    return;
  }

  rows = data || [];

  await loadDisplayMaps();

  const defaults = {
    customers: ["display_code", "full_name", "email", "phone", "status", "consent", "joined_on"],
    membership_plans: ["display_code", "name", "price", "duration_months"],
    opportunities: ["display_code", "customer_id", "plan_id", "owner_id", "stage", "created_on"],
    orders: ["display_code", "customer_id", "plan_id", "opportunity_id", "amount", "order_date"],
    tickets: ["display_code", "customer_id", "assigned_to", "subject", "status", "satisfaction", "opened_at", "closed_at"],
    interactions: ["display_code", "customer_id", "user_id", "ticket_id", "channel", "notes", "logged_at"],
    users: ["display_code", "full_name", "email", "role"],
  };

  const availableColumns = rows.length ? Object.keys(rows[0]) : [];

  columns = rows.length
    ? [
        "display_code",
        ...availableColumns.filter(
          column => column !== "id" && column !== "display_code"
        ),
      ].filter(column => availableColumns.includes(column))
    : defaults[view] || [];

  renderRows();
}

function renderRows() {
  const query = ($("#search").value || "").toLowerCase().trim();

  const filtered = rows.filter(row =>
    !query ||
    Object.values(row).some(value =>
      safe(value).toLowerCase().includes(query)
    ) ||
    columns.some(column =>
      displayCell(column, row[column], row).toLowerCase().includes(query)
    )
  );

  $("#count").textContent =
    `${filtered.length} record${filtered.length === 1 ? "" : "s"}`;

  $("#thead").innerHTML = `
    <tr>
      ${columns.map(column =>
        `<th>${esc(column.replaceAll("_", " "))}</th>`
      ).join("")}
      <th>Actions</th>
    </tr>
  `;

  $("#tbody").innerHTML = filtered.map(row => {
    const idx = rows.indexOf(row);
    const readOnly = view === "users";

    return `
      <tr>
        ${columns.map(column => {
          const raw = safe(row[column]);
          const display = displayCell(column, row[column], row);

          return `<td title="${esc(raw)}">${esc(display)}</td>`;
        }).join("")}

        <td>
          <div class="actions">
            <button
              class="text-btn"
              data-action="edit"
              data-index="${idx}"
              ${!readOnly && staffOrAdmin() ? "" : "disabled"}
            >Edit</button>

            <button
              class="text-btn danger"
              data-action="delete"
              data-index="${idx}"
              ${!readOnly && admin() ? "" : "disabled"}
            >Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  $("#empty").classList.toggle("hidden", filtered.length > 0);

  if (!filtered.length) {
    $("#empty h3").textContent = query
      ? "No matching records"
      : "No records to show";

    $("#empty p").textContent = query
      ? "Try another search term."
      : "You can add a record if your role has permission.";
  }

  $("#tbody").querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      const row = rows[Number(button.dataset.index)];

      if (button.dataset.action === "edit") {
        openEditor(row);
      } else {
        removeRow(row);
      }
    });
  });
}

const FIELD_CONFIG = {
  customers: [
    { key: "full_name", label: "Full name", required: true, maxLength: 120 },
    { key: "email", label: "Email address", type: "email", required: true },
    { key: "phone", label: "Phone number", required: true, placeholder: "+63 917 000 0000" },
    {
      key: "status",
      label: "Customer status",
      type: "select",
      options: [
        ["lead", "Lead"],
        ["active", "Active member"],
        ["inactive", "Inactive"]
      ],
      default: "lead",
      required: true
    },
    { key: "consent", label: "Marketing consent", type: "checkbox", default: false },
    { key: "joined_on", label: "Joined date", type: "date" },
  ],

  membership_plans: [
    { key: "name", label: "Plan name", required: true, maxLength: 80 },
    { key: "price", label: "Price (PHP ₱)", type: "number", min: 0, step: "0.01", required: true },
    { key: "duration_months", label: "Duration (months)", type: "number", min: 1, max: 120, step: 1, required: true },
  ],

  opportunities: [
    { key: "customer_id", label: "Customer", type: "reference", table: "customers", required: true, display: "full_name" },
    { key: "plan_id", label: "Membership plan", type: "reference", table: "membership_plans", required: true, display: "name" },
    { key: "owner_id", label: "Assigned staff member", type: "reference", table: "users", required: true, display: "full_name" },
    {
      key: "stage",
      label: "Sales stage",
      type: "select",
      options: [
        ["Lead", "Lead"],
        ["Qualified", "Qualified"],
        ["Proposal", "Proposal"],
        ["Won", "Won"],
        ["Lost", "Lost"]
      ],
      default: "Lead",
      required: true
    },
    { key: "created_on", label: "Opportunity date", type: "date" },
  ],

  orders: [
    { key: "customer_id", label: "Customer", type: "reference", table: "customers", required: true, display: "full_name" },
    { key: "plan_id", label: "Membership plan", type: "reference", table: "membership_plans", required: true, display: "name" },
    { key: "opportunity_id", label: "Related opportunity (optional)", type: "reference", table: "opportunities", display: "display_code", optional: true },
    { key: "amount", label: "Order amount (PHP ₱)", type: "number", min: 0, step: "0.01", required: true },
    { key: "order_date", label: "Order date", type: "date" },
  ],

  tickets: [
    { key: "customer_id", label: "Customer", type: "reference", table: "customers", required: true, display: "full_name" },
    { key: "assigned_to", label: "Assign to staff (optional)", type: "reference", table: "users", display: "full_name", optional: true },
    { key: "subject", label: "Concern / subject", required: true, minLength: 3, maxLength: 200 },
    {
      key: "status",
      label: "Ticket status",
      type: "select",
      options: [
        ["open", "Open"],
        ["assigned", "Assigned"],
        ["closed", "Closed"]
      ],
      default: "open",
      required: true
    },
    { key: "satisfaction", label: "Satisfaction rating (optional)", type: "number", min: 1, max: 5, step: 1, optional: true },
  ],

  interactions: [
    { key: "customer_id", label: "Customer", type: "reference", table: "customers", required: true, display: "full_name" },
    { key: "user_id", label: "Staff member", type: "reference", table: "users", required: true, display: "full_name" },
    { key: "ticket_id", label: "Related ticket (optional)", type: "reference", table: "tickets", display: "subject", optional: true },
    {
      key: "channel",
      label: "Contact channel",
      type: "select",
      options: [
        ["call", "Call"],
        ["chat", "Chat"],
        ["walk-in", "Walk-in"],
        ["email", "Email"]
      ],
      required: true,
      default: "chat"
    },
    { key: "notes", label: "Notes", type: "textarea", maxLength: 2000 },
  ],
};

function defaultFieldValue(field, row) {
  if (row && row[field.key] !== undefined && row[field.key] !== null) {
    return row[field.key];
  }

  if (field.default !== undefined) return field.default;

  if (
    field.type === "date" &&
    ["joined_on", "created_on", "order_date"].includes(field.key)
  ) {
    return new Date().toISOString().slice(0, 10);
  }

  return "";
}

async function loadReferenceOptions(field) {
  if (editorOptions[field.table]) {
    return editorOptions[field.table];
  }

  const displayColumn = field.display || "id";

  // Avoid selecting the same column twice.
  const selectColumns = [
    ...new Set(["id", "display_code", displayColumn])
  ].join(", ");

  let query = db
    .from(field.table)
    .select(selectColumns)
    .limit(500);

  if (field.table === "users") {
    query = query.in("role", ["Admin", "Staff"]);
  }

  const { data, error } = await query;

  if (error) throw error;

  editorOptions[field.table] = data || [];
  return editorOptions[field.table];
}

function fieldControl(field, value, row) {
  const id = `field-${field.key}`;

  const required =
    field.required && !(field.optional && row && value === "")
      ? "required"
      : "";

  const common = `
    id="${id}"
    name="${field.key}"
    ${required}
    ${field.minLength ? `minlength="${field.minLength}"` : ""}
    ${field.maxLength ? `maxlength="${field.maxLength}"` : ""}
    ${field.min !== undefined ? `min="${field.min}"` : ""}
    ${field.max !== undefined ? `max="${field.max}"` : ""}
    ${field.step ? `step="${field.step}"` : ""}
    placeholder="${esc(field.placeholder || "")}"
  `;

  if (field.type === "checkbox") {
    return `
      <label class="check-field" for="${id}">
        <input ${common} type="checkbox" ${value ? "checked" : ""}>
        ${esc(field.label)}
      </label>
    `;
  }

  if (field.type === "select") {
    return `
      <label for="${id}">${esc(field.label)}</label>
      <select ${common}>
        ${field.options.map(([v, text]) => `
          <option value="${esc(v)}" ${String(value) === v ? "selected" : ""}>
            ${esc(text)}
          </option>
        `).join("")}
      </select>
    `;
  }

  if (field.type === "reference") {
    const opts = editorOptions[field.table] || [];

    return `
      <label for="${id}">${esc(field.label)}</label>
      <select ${common}>
        <option value="">
          ${field.optional ? "None selected" : "Choose an option"}
        </option>
        ${opts.map(option => {
          const code = option.display_code || option.id;

          const label = field.display === "display_code"
            ? code
            : `${code} — ${option[field.display] || ""}`;

          return `
            <option
              value="${esc(option.id)}"
              ${String(value) === String(option.id) ? "selected" : ""}
            >
              ${esc(label)}
            </option>
          `;
        }).join("")}
      </select>
    `;
  }

  if (field.type === "textarea") {
    return `
      <label for="${id}">${esc(field.label)}</label>
      <textarea ${common} rows="4">${esc(value)}</textarea>
    `;
  }

  return `
    <label for="${id}">${esc(field.label)}</label>
    <input ${common} type="${field.type || "text"}" value="${esc(value)}">
  `;
}

async function openEditor(row = null) {
  if (view === "users" || !staffOrAdmin()) return;

  editing = row;

  $("#editorTitle").textContent =
    `${row ? "Edit" : "Add"} ${TABLES[view][0].replace(/s$/, "")}`;

  $("#editorMessage").textContent = "";
  $("#editorHelp").textContent =
    "Enter the details below. Fields marked optional can be left blank.";

  const fields = FIELD_CONFIG[view] || [];

  try {
    editorOptions = {};

    for (const field of fields.filter(f => f.type === "reference")) {
      await loadReferenceOptions(field);
    }

    $("#editorFields").innerHTML = fields
      .map(field => `
        <div class="field-wrap">
          ${fieldControl(field, defaultFieldValue(field, row), row)}
        </div>
      `)
      .join("");

    $("#editorDialog").showModal();
  } catch (error) {
    $("#editorMessage").textContent =
      `Could not load form options: ${errText(error)}`;
    $("#editorDialog").showModal();
  }
}

$("#editorForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (view === "users" || !FIELD_CONFIG[view]) return;

  const payload = {};

  for (const field of FIELD_CONFIG[view]) {
    const control = document.getElementById(`field-${field.key}`);
    if (!control) continue;

    let value =
      field.type === "checkbox" ? control.checked : control.value;

    if (value === "" && (field.optional || !field.required)) {
      if (field.type !== "checkbox") value = null;
    } else if (field.type === "number" && value !== "") {
      value = Number(value);
    }

    if (value !== "" && value !== null && value !== undefined) {
      payload[field.key] = value;
    } else if (field.type === "checkbox") {
      payload[field.key] = false;
    } else if (field.optional) {
      payload[field.key] = null;
    }
  }

  if (view === "tickets" && payload.status === "closed") {
    $("#editorMessage").textContent =
      "To close a ticket, this database requires a closure time and satisfaction rating. Keep it Open or Assigned here, or use a dedicated close-ticket workflow.";
    return;
  }

  const button = $("#save");
  button.disabled = true;
  button.textContent = "Saving…";
  $("#editorMessage").textContent = "";

  try {
    let result;

    if (editing) {
      result = await db
        .from(view)
        .update(payload)
        .eq("id", editing.id);
    } else {
      result = await db.from(view).insert(payload);
    }

    if (result.error) throw result.error;

    $("#editorDialog").close();
    notify(editing ? "Record updated." : "Record added.");

    await loadTable();
    await dashboard();
  } catch (error) {
    $("#editorMessage").textContent = errText(error);
  } finally {
    button.disabled = false;
    button.textContent = "Save record";
  }
});

async function removeRow(row) {
  if (!admin()) {
    return notify("Only an Admin can delete records.", true);
  }

  if (!confirm("Delete this record? This cannot be undone.")) return;

  const { error } = await db
    .from(view)
    .delete()
    .eq("id", row.id);

  if (error) return notify(errText(error), true);

  notify("Record deleted.");

  await loadTable();
  await dashboard();
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!db && !setupClient()) return;

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

    await enterApp(data.user);
  } catch (error) {
    message(errText(error));
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
    document.querySelector("#loadingOverlay")?.classList.remove("active");
    document.querySelector("#loadingOverlay")?.setAttribute("aria-hidden", "true");
  }
});

$("#logout").addEventListener("click", signOut);

$("#menu").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$("#nav").addEventListener("click", e => {
  const button = e.target.closest("[data-view]");
  if (button) navigate(button.dataset.view);
});

document.querySelectorAll("[data-jump]").forEach(button => {
  button.addEventListener("click", () => navigate(button.dataset.jump));
});

$("#addBtn").addEventListener("click", () => openEditor());
$("#closeDialog").addEventListener("click", () => $("#editorDialog").close());
$("#cancel").addEventListener("click", () => $("#editorDialog").close());
$("#search").addEventListener("input", renderRows);

async function boot() {
  if (!setupClient()) return;

  const { data, error } = await db.auth.getSession();

  if (error) message(errText(error));

  if (data.session?.user) {
    try {
      await enterApp(data.session.user);
    } catch (error) {
      message(errText(error));
      await db.auth.signOut();
    }
  }

  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      user = profile = null;
      $("#app").classList.add("hidden");
      $("#loginScreen").classList.remove("hidden");
      $("#clientPortal").classList.add("hidden");
      $("#sidebar").classList.remove("client-mode");
    }

    if (event === "SIGNED_IN" && session?.user && !user) {
      setTimeout(
        () => enterApp(session.user).catch(error => message(errText(error))),
        0
      );
    }
  });
}

boot();

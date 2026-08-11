/**
 * Email confirmation result page.
 *
 * Kept in its own file rather than inline: the site is served with
 * `script-src 'self'`, which blocks inline <script> outright. An inline version
 * simply never runs, leaving the page stuck on "Checking your link" with the
 * reason buried in the console.
 */
(function () {
  "use strict";

  // The publishable (anon) key is designed to be public and already ships in
  // the app bundle. The service-role key must never appear in a browser.
  var SUPABASE_URL = "https://yhgkrbnmhgspgckvvfhe.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_nN_8jw_J1FTuGtVIJ7KuQA_V5bY8yn6";

  function byId(id) {
    return document.getElementById(id);
  }

  function render(state, title, text, listTitle, list, note) {
    var badge = byId("badge");
    var spinner = byId("spinner");

    if (spinner) spinner.hidden = state !== "checking";
    if (badge) {
      badge.className = "badge" + (state === "ok" ? " ok" : state === "bad" ? " bad" : "");
    }

    byId("badge-text").textContent =
      state === "ok" ? "Email verified" : state === "bad" ? "Not verified" : "Checking your link";
    byId("heading").textContent = title;
    byId("message").textContent = text;

    var steps = byId("steps");
    var stepsList = byId("steps-list");
    stepsList.innerHTML = "";

    if (list && list.length) {
      byId("steps-title").textContent = listTitle;
      list.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = item;
        stepsList.appendChild(li);
      });
      steps.hidden = false;
    } else {
      steps.hidden = true;
    }

    byId("detail").textContent = note || "";
  }

  function succeeded() {
    render(
      "ok",
      "You're all set",
      "Your email address is confirmed. Open the Nutripilots app and sign in with the password you chose.",
      "What to do next",
      ["Close this page.", "Open the Nutripilots app.", "Sign in with your email and password."]
    );
  }

  function failed(reason) {
    render(
      "bad",
      "We could not verify your email",
      "This link may be invalid, expired or already used. Please request a new verification email from Nutripilots.",
      "If you already confirmed",
      [
        "Open the Nutripilots app.",
        "Try signing in — the link may simply have been used already."
      ],
      reason || ""
    );
  }

  function run() {
    // Supabase returns its result in the query string or the fragment,
    // depending on which template and flow sent the user here. Read both.
    var query = new URLSearchParams(window.location.search);
    var fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    function param(name) {
      return query.get(name) || fragment.get(name);
    }

    var error = param("error_description") || param("error");
    var tokenHash = param("token_hash");
    var type = param("type") || "email";

    if (error) {
      // An explicit rejection is never dressed up as a success.
      failed(decodeURIComponent(error).replace(/\+/g, " "));
      return;
    }

    if (tokenHash) {
      // The strongest check available: hand the one-time token back to Supabase
      // and believe only its answer. This is the call verifyOtp makes.
      fetch(SUPABASE_URL + "/auth/v1/verify", {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ type: type, token_hash: tokenHash })
      })
        .then(function (response) {
          return response.json().then(function (body) {
            return { ok: response.ok, body: body };
          });
        })
        .then(function (result) {
          if (result.ok && result.body && result.body.access_token) succeeded();
          else failed(result.body && result.body.msg ? result.body.msg : "");
        })
        .catch(function () {
          render(
            "bad",
            "We could not reach Nutripilots",
            "Check your connection and open this link again.",
            null,
            null
          );
        });
      return;
    }

    if (query.get("code")) {
      // The stock Supabase template routes the user through /auth/v1/verify,
      // which checks the token server-side and only then redirects here. A
      // rejected link never arrives with a code — it arrives as
      // ?error=access_denied&error_code=otp_expired, caught above. So a code
      // with no error means Supabase accepted the link.
      //
      // The code itself cannot be exchanged here: PKCE needs the verifier held
      // by the client that began the flow. No exchange is needed to report an
      // outcome already decided upstream.
      succeeded();
      return;
    }

    if (fragment.get("access_token")) {
      // Implicit flow: Supabase verified the link before redirecting.
      succeeded();
      return;
    }

    // Nothing to go on. A bare ?verified=true proves nothing.
    failed("This link carried no verification token.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();

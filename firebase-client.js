const firebaseState = {
  ready: false,
  configured: false,
  mode: "local",
  user: null,
  error: "",
  auth: null,
  db: null,
  sdk: null
};

const localKeys = {
  accounts: "marketlens-local-accounts",
  session: "marketlens-local-session"
};

function readLocalJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function localAccounts() {
  const accounts = readLocalJson(localKeys.accounts, []);
  return Array.isArray(accounts) ? accounts : [];
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function passwordHash(password, saltBase64) {
  const encoder = new TextEncoder();
  const salt = Uint8Array.from(atob(saltBase64), character => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return bytesToBase64(bits);
}

function localProfileKey(uid) { return `marketlens-local-profile-${uid}`; }
function localChatsKey(uid) { return `marketlens-local-chats-${uid}`; }

function startLocalSession(account) {
  firebaseState.mode = "local";
  firebaseState.user = { uid: account.uid, email: account.email, displayName: account.displayName || "" };
  localStorage.setItem(localKeys.session, account.uid);
  emitAuthState();
}

function publicUser(user) {
  return user ? { uid: user.uid, email: user.email || "", displayName: user.displayName || "" } : null;
}

function emitAuthState() {
  window.dispatchEvent(new CustomEvent("marketlens-auth-change", { detail: {
    ready: firebaseState.ready,
    configured: firebaseState.configured,
    mode: firebaseState.mode,
    user: publicUser(firebaseState.user),
    error: firebaseState.error
  }}));
}

window.marketLensFirebase = {
  state: firebaseState,
  async signIn(email, password) {
    if (!firebaseState.auth) {
      const normalizedEmail = normalizeEmail(email);
      const account = localAccounts().find(item => normalizeEmail(item.email) === normalizedEmail);
      if (!account || await passwordHash(password, account.salt) !== account.passwordHash) {
        const error = new Error("The email or password is incorrect."); error.code = "auth/invalid-credential"; throw error;
      }
      startLocalSession(account);
      return { user: firebaseState.user };
    }
    return firebaseState.sdk.signInWithEmailAndPassword(firebaseState.auth, email, password);
  },
  async signUp(name, email, password) {
    const normalizedEmail = normalizeEmail(email);
    if (!firebaseState.auth) {
      if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) { const error = new Error("Enter a valid email address."); error.code = "auth/invalid-email"; throw error; }
      if (String(password).length < 6) { const error = new Error("Use at least six password characters."); error.code = "auth/weak-password"; throw error; }
      const accounts = localAccounts();
      if (accounts.some(account => normalizeEmail(account.email) === normalizedEmail)) { const error = new Error("An account already uses this email."); error.code = "auth/email-already-in-use"; throw error; }
      const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
      const account = {
        uid: crypto.randomUUID?.() || `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
        email: normalizedEmail,
        displayName: String(name || "").trim().slice(0, 40),
        salt,
        passwordHash: await passwordHash(password, salt),
        createdAt: Date.now()
      };
      accounts.push(account);
      localStorage.setItem(localKeys.accounts, JSON.stringify(accounts));
      startLocalSession(account);
      return { user: firebaseState.user };
    }
    const credential = await firebaseState.sdk.createUserWithEmailAndPassword(firebaseState.auth, normalizedEmail, password);
    if (name.trim()) await firebaseState.sdk.updateProfile(credential.user, { displayName: name.trim().slice(0, 40) });
    await firebaseState.sdk.setDoc(firebaseState.sdk.doc(firebaseState.db, "users", credential.user.uid), {
      displayName: name.trim().slice(0, 40), email: normalizedEmail, createdAt: firebaseState.sdk.serverTimestamp()
    }, { merge: true });
    return credential;
  },
  async signInWithGoogle() {
    if (!firebaseState.auth) {
      const error = new Error("Connect Firebase to enable Google sign-in.");
      error.code = "auth/firebase-not-configured";
      throw error;
    }
    const provider = new firebaseState.sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await firebaseState.sdk.signInWithPopup(firebaseState.auth, provider);
    await firebaseState.sdk.setDoc(firebaseState.sdk.doc(firebaseState.db, "users", credential.user.uid), {
      displayName: credential.user.displayName || "",
      email: normalizeEmail(credential.user.email),
      photoURL: credential.user.photoURL || "",
      lastLoginAt: firebaseState.sdk.serverTimestamp()
    }, { merge: true });
    return credential;
  },
  async signOut() {
    if (firebaseState.auth) await firebaseState.sdk.firebaseSignOut(firebaseState.auth);
    else { localStorage.removeItem(localKeys.session); firebaseState.user = null; emitAuthState(); }
  },
  async loadProfile() {
    if (!firebaseState.user) return null;
    if (!firebaseState.db) return readLocalJson(localProfileKey(firebaseState.user.uid), null);
    const snapshot = await firebaseState.sdk.getDoc(firebaseState.sdk.doc(firebaseState.db, "users", firebaseState.user.uid));
    return snapshot.exists() ? snapshot.data() : null;
  },
  async saveProfile(data) {
    if (!firebaseState.user) return;
    if (!firebaseState.db) {
      const current = readLocalJson(localProfileKey(firebaseState.user.uid), {});
      localStorage.setItem(localProfileKey(firebaseState.user.uid), JSON.stringify({ ...current, ...data, updatedAt: Date.now() }));
      return;
    }
    await firebaseState.sdk.setDoc(firebaseState.sdk.doc(firebaseState.db, "users", firebaseState.user.uid), {
      ...data, updatedAt: firebaseState.sdk.serverTimestamp()
    }, { merge: true });
  },
  async listConversations() {
    if (!firebaseState.user) return [];
    if (!firebaseState.db) return readLocalJson(localChatsKey(firebaseState.user.uid), []);
    const reference = firebaseState.sdk.collection(firebaseState.db, "users", firebaseState.user.uid, "conversations");
    const snapshot = await firebaseState.sdk.getDocs(firebaseState.sdk.query(reference, firebaseState.sdk.orderBy("updatedAt", "desc")));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  },
  async saveConversation(conversation) {
    if (!firebaseState.user || !conversation?.id) return;
    if (!firebaseState.db) {
      const chats = readLocalJson(localChatsKey(firebaseState.user.uid), []);
      const index = chats.findIndex(chat => chat.id === conversation.id);
      const saved = { ...conversation, updatedAt: Date.now() };
      if (index >= 0) chats[index] = saved; else chats.unshift(saved);
      localStorage.setItem(localChatsKey(firebaseState.user.uid), JSON.stringify(chats.slice(0, 50)));
      return;
    }
    await firebaseState.sdk.setDoc(firebaseState.sdk.doc(firebaseState.db, "users", firebaseState.user.uid, "conversations", conversation.id), {
      title: conversation.title,
      messages: conversation.messages,
      ticker: conversation.ticker || "",
      createdAt: conversation.createdAt || Date.now(),
      updatedAt: firebaseState.sdk.serverTimestamp()
    }, { merge: true });
  },
  async deleteConversation(id) {
    if (!firebaseState.user || !id) return;
    if (!firebaseState.db) {
      const chats = readLocalJson(localChatsKey(firebaseState.user.uid), []).filter(chat => chat.id !== id);
      localStorage.setItem(localChatsKey(firebaseState.user.uid), JSON.stringify(chats));
      return;
    }
    await firebaseState.sdk.deleteDoc(firebaseState.sdk.doc(firebaseState.db, "users", firebaseState.user.uid, "conversations", id));
  }
};

async function initializeFirebase() {
  try {
    const response = await fetch("/api/firebase/config");
    const payload = await response.json();
    firebaseState.configured = Boolean(payload.configured);
    if (!firebaseState.configured) {
      firebaseState.mode = "local";
      const sessionUid = localStorage.getItem(localKeys.session);
      const account = localAccounts().find(item => item.uid === sessionUid);
      firebaseState.user = account ? { uid: account.uid, email: account.email, displayName: account.displayName || "" } : null;
      firebaseState.ready = true;
      emitAuthState();
      return;
    }
    const version = "12.15.0";
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
    ]);
    const firebaseApp = appSdk.initializeApp(payload.config);
    firebaseState.mode = "firebase";
    firebaseState.auth = authSdk.getAuth(firebaseApp);
    firebaseState.db = firestoreSdk.getFirestore(firebaseApp);
    firebaseState.sdk = {
      ...authSdk, ...firestoreSdk,
      firebaseSignOut: authSdk.signOut
    };
    await authSdk.setPersistence(firebaseState.auth, authSdk.browserLocalPersistence);
    authSdk.onAuthStateChanged(firebaseState.auth, user => {
      firebaseState.user = user;
      firebaseState.ready = true;
      emitAuthState();
    });
  } catch (error) {
    firebaseState.error = error.message || "Firebase could not be initialized.";
    firebaseState.mode = "local";
    const sessionUid = localStorage.getItem(localKeys.session);
    const account = localAccounts().find(item => item.uid === sessionUid);
    firebaseState.user = account ? { uid: account.uid, email: account.email, displayName: account.displayName || "" } : null;
    firebaseState.ready = true;
    emitAuthState();
  }
}

initializeFirebase();

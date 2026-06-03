import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    // ⚠️ REPLACE THESE WITH YOUR FIREBASE CONFIGURATION ⚠️
 apiKey: "AIzaSyDX_BOKpoxpvhLpbn8dfYKIMde1R-uxlIY",
  authDomain: "cardetailing-b7f14.firebaseapp.com",
  databaseURL: "https://cardetailing-b7f14-default-rtdb.firebaseio.com",
  projectId: "cardetailing-b7f14",
  storageBucket: "cardetailing-b7f14.firebasestorage.app",
  messagingSenderId: "105489690407",
  appId: "1:105489690407:web:a1a45e4477ba7d9e670302"
};

// Initialize Firebase
let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully.");
} catch (e) {
    console.error("Firebase initialization failed. Make sure you replaced the config.", e);
}

// Maps localStorage keys to Firestore collections and specifies the unique ID field for each document.
const syncMap = {
    'apex_bookings': { collection: 'bookings', idField: 'id' },
    'apex_workers': { collection: 'workers', idField: 'name' },
    'apex_clients': { collection: 'clients', idField: 'name' }, // Fallback to email if name doesn't exist
    'apex_worker_applications': { collection: 'applications', idField: 'email' },
    'apex_discount_codes': { collection: 'discount_codes', idField: 'code' },
    'apex_logs': { collection: 'logs', idField: 'id' }
};

// --- DOWNSTREAM SYNC (Firestore -> LocalStorage) ---
if (db) {
    Object.keys(syncMap).forEach(key => {
        const config = syncMap[key];
        onSnapshot(collection(db, config.collection), (snapshot) => {
            const dataArray = [];
            snapshot.forEach(docSnap => {
                dataArray.push(docSnap.data());
            });
            // Update local storage silently (so we don't trigger upstream sync infinitely)
            localStorage.setItem(key, JSON.stringify(dataArray));
            
            // Dispatch event so UI can update if necessary
            window.dispatchEvent(new Event('firebaseUpdate'));
        }, (error) => {
            console.error(`Error listening to ${config.collection}:`, error);
        });
    });
}

// --- UPSTREAM SYNC (LocalStorage -> Firestore) ---
window.fbSetItem = async function(key, val) {
    // 1. Immediately update UI/LocalStorage for synchronous speed
    localStorage.setItem(key, val);
    window.dispatchEvent(new Event('firebaseUpdate'));

    // 2. Sync to Firestore in the background
    if (!db || !syncMap[key]) return;

    try {
        const config = syncMap[key];
        const dataArray = JSON.parse(val);
        
        if (!Array.isArray(dataArray)) {
            // If it's not an array (e.g. apex_active_worker), store it as a single doc
            await setDoc(doc(db, 'system', key), dataArray);
            return;
        }

        // Get all current documents in Firestore to handle deletions
        const currentDocsSnap = await getDocs(collection(db, config.collection));
        const currentDocIds = new Set();
        currentDocsSnap.forEach(d => currentDocIds.add(d.id));

        // Upload/Update all items in the array
        const newDocIds = new Set();
        
        for (let i = 0; i < dataArray.length; i++) {
            const item = dataArray[i];
            
            // Determine document ID
            let docId = item[config.idField];
            if (!docId) {
                // Fallback ID generation
                docId = item.email || item.phone || `item_${i}_${Date.now()}`;
                item[config.idField] = docId; // Ensure it has an ID
            }
            
            // Sanitize docId for Firestore (no slashes)
            docId = String(docId).replace(/\//g, '_');
            newDocIds.add(docId);

            // Write to Firestore
            await setDoc(doc(db, config.collection, docId), item);
        }

        // Delete any documents in Firestore that are no longer in the array
        for (const oldId of currentDocIds) {
            if (!newDocIds.has(oldId)) {
                await deleteDoc(doc(db, config.collection, oldId));
            }
        }
    } catch (e) {
        console.error(`Firebase Upstream Sync Error for ${key}:`, e);
    }
};

// Process any items queued while Firebase was initializing
if (window.fbSetItemQueue) {
    window.fbSetItemQueue.forEach(item => window.fbSetItem(item.key, item.val));
    window.fbSetItemQueue = [];
}

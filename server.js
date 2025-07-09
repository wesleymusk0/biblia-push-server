const admin = require("firebase-admin");
const express = require("express");

// Verifica a variável de ambiente obrigatória
if (!process.env.FIREBASE_DATABASE_URL) {
  console.error("ERRO: Variável FIREBASE_DATABASE_URL não definida.");
  process.exit(1);
}

// Inicializa Express
const app = express();
app.get("/", (req, res) => res.send("Servidor de notificações BiblIA está ativo!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escutando na porta ${PORT}`));

// Inicializa Firebase Admin
try {
  const serviceAccount = require("/etc/secrets/firebase-credentials.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  console.log("Firebase Admin SDK inicializado.");
} catch (e) {
  console.error("Erro ao iniciar Firebase:", e.message);
  process.exit(1);
}

const db = admin.database();
const librariesRef = db.ref("libraries");
const listeners = new Set();

librariesRef.once("value", (snapshot) => {
  snapshot.forEach((librarySnap) => {
    const libraryId = librarySnap.key;
    const notificationsRef = db.ref(`libraries/${libraryId}/notifications`);

    notificationsRef.once("value", (alunosSnap) => {
      alunosSnap.forEach((alunoSnap) => {
        const alunoUid = alunoSnap.key;
        const alunoNotificationsRef = notificationsRef.child(alunoUid);

        const listenerKey = `${libraryId}_${alunoUid}`;
        if (listeners.has(listenerKey)) return;
        listeners.add(listenerKey);

        alunoNotificationsRef.on("child_added", async (notifSnap) => {
          const notifId = notifSnap.key;
          const data = notifSnap.val();

          if (!data || data.status === "processing" || data.status === "sent") return;

          await notifSnap.ref.update({ status: "processing" });

          console.log(`📣 Enviando notificação [${notifId}] para aluno ${alunoUid}: "${data.message}"`);

          const tokensSnap = await admin.database().ref(`users/${alunoUid}/fcmTokens`).get();

          if (!tokensSnap.exists()) {
            console.warn(`Nenhum token FCM encontrado para ${alunoUid}.`);
            await notifSnap.ref.remove();
            return;
          }

          const tokens = Object.keys(tokensSnap.val());
          if (tokens.length === 0) {
            console.warn(`Tokens vazios para ${alunoUid}.`);
            await notifSnap.ref.remove();
            return;
          }

          const message = {
            notification: {
              title: "Biblioteca",
              body: data.message,
            },
            webpush: {
              fcm_options: { link: "https://systematrix.com.br/biblia" },
            }
          };

          let success = 0;
          let failed = [];

          for (const token of tokens) {
            try {
              await admin.messaging().send({ ...message, token });
              success++;
            } catch (err) {
              console.warn(`Erro com token (${token}):`, err.message);
              failed.push(token);
            }
          }

          console.log(`✅ Notificação enviada com sucesso para ${success}/${tokens.length} tokens do aluno ${alunoUid}.`);

          for (const token of failed) {
            await admin.database().ref(`users/${alunoUid}/fcmTokens/${token}`).remove();
          }

          await notifSnap.ref.remove(); // remove da fila
        });
      });
    });
  });
});

console.log("🟢 Servidor pronto para processar notificações.");

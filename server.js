// server.js - VERSÃO COM ENVIO INDIVIDUAL POR USUÁRIO (loop com send)

const admin = require("firebase-admin");
const express = require("express");

// Validação do ambiente
if (!process.env.FIREBASE_DATABASE_URL) {
  console.error("ERRO: Variável de ambiente FIREBASE_DATABASE_URL não definida.");
  process.exit(1);
}

// Inicialização do Express
const app = express();
app.get("/", (req, res) => {
  res.send("Servidor de notificações BiblIA está ativo!");
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor web escutando na porta ${PORT}`);
});

// Inicialização do Firebase Admin
try {
  const serviceAccount = require("/etc/secrets/firebase-credentials.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  console.log("Firebase Admin SDK inicializado com sucesso.");
} catch (e) {
  console.error("ERRO ao inicializar Firebase:", e.message);
  process.exit(1);
}

// Lógica Principal
const db = admin.database();
const librariesRef = db.ref("/libraries");
const listeners = new Set(); // Controle de listeners ativos

librariesRef.once("value", (snapshot) => {
  snapshot.forEach((librarySnap) => {
    const librarianUid = librarySnap.key;
    const notificationsRef = librarySnap.ref.child("notifications");

    if (listeners.has(librarianUid)) return;
    listeners.add(librarianUid);

    notificationsRef.on("child_added", async (notificationSnapshot) => {
      const notificationId = notificationSnapshot.key;
      const notificationData = notificationSnapshot.val();

      if (!notificationData || notificationData.status === 'processing' || notificationData.status === 'sent') {
        return;
      }

      await notificationSnapshot.ref.update({ status: 'processing' });

      console.log(`Processando notificação [${notificationId}] para o bibliotecário ${librarianUid}: "${notificationData.message}"`);

      const tokensSnapshot = await admin.database().ref(`/users/${librarianUid}/fcmTokens`).get();

      if (!tokensSnapshot.exists()) {
        console.log(`Nenhum token FCM encontrado para ${librarianUid}. Removendo notificação.`);
        await notificationSnapshot.ref.remove();
        return;
      }

      const tokens = Object.keys(tokensSnapshot.val());

      if (tokens.length === 0) {
        console.log(`Lista de tokens vazia para ${librarianUid}. Removendo notificação.`);
        await notificationSnapshot.ref.remove();
        return;
      }

      const message = {
        notification: {
          title: "Biblioteca",
          body: notificationData.message,
        },
        webpush: {
          fcm_options: { link: "https://systematrix.com.br/biblia" },
        }
      };

      let successCount = 0;
      let failedTokens = [];

      for (const token of tokens) {
        try {
          await admin.messaging().send({ ...message, token });
          successCount++;
        } catch (error) {
          console.warn(`Erro ao enviar para token inválido (${token}):`, error.message);
          failedTokens.push(token);
        }
      }

      console.log(`Notificação [${notificationId}] enviada com sucesso para ${successCount} de ${tokens.length} dispositivos do bibliotecário ${librarianUid}.`);

      if (failedTokens.length > 0) {
        console.warn(`Removendo ${failedTokens.length} token(s) inválido(s) de ${librarianUid}.`);
        for (const token of failedTokens) {
          await admin.database().ref(`/users/${librarianUid}/fcmTokens/${token}`).remove();
        }
      }

      await notificationSnapshot.ref.remove(); // Remove da fila
    });
  });
});

console.log("Servidor pronto e ouvindo por novas notificações.");

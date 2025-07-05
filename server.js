// server.js - VERSÃO FINAL CORRIGIDA (Anti-duplicação de listeners)

// 1. Importações
const admin = require("firebase-admin");
const express = require("express");

// 2. Validação e Inicialização do Express
if (!process.env.FIREBASE_DATABASE_URL) {
  console.error("ERRO: Variável de ambiente FIREBASE_DATABASE_URL não definida.");
  process.exit(1);
}
const app = express();
app.get("/", (req, res) => {
  res.send("Servidor de notificações BiblIA está ativo!");
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor web escutando na porta ${PORT}`);
});

// 3. Inicialização do Firebase Admin
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

// 4. Lógica Principal: Ouvir o banco de dados
const db = admin.database();
const notificationsRef = db.ref("/notifications");

// Set para controlar quais UIDs já possuem listener ativo
const listeners = new Set();

notificationsRef.on("child_added", (userSnapshot) => {
  const uid = userSnapshot.key;

  // Prevenção contra múltiplos listeners para o mesmo usuário
  if (listeners.has(uid)) return;
  listeners.add(uid);

  const userNotificationsRef = userSnapshot.ref;

  userNotificationsRef.on("child_added", async (notificationSnapshot) => {
    const notificationId = notificationSnapshot.key;
    const notificationData = notificationSnapshot.val();

    // Verificação de segurança para evitar processamento duplicado
    if (!notificationData || notificationData.status === 'processing' || notificationData.status === 'sent') {
      return;
    }

    // Marcar como em processamento
    await notificationSnapshot.ref.update({ status: 'processing' });

    console.log(`Processando notificação [${notificationId}] para o usuário ${uid}: "${notificationData.message}"`);

    // Buscar tokens FCM do usuário
    const tokensSnapshot = await admin.database().ref(`/users/${uid}/fcmTokens`).get();

    if (!tokensSnapshot.exists()) {
      console.log(`Nenhum token FCM encontrado para ${uid}. Removendo notificação.`);
      await notificationSnapshot.ref.remove();
      return;
    }

    const tokens = Object.keys(tokensSnapshot.val());
    const notificationsToSend = tokens.map(token => {
      return admin.messaging().send({
        notification: {
          title: "Biblioteca",
          body: notificationData.message,
        },
        webpush: {
          fcm_options: { link: "https://systematrix.com.br/biblia" },
        },
        token
      });
    });

    try {
      // Enviar notificações paralelamente
      await Promise.all(notificationsToSend);
      console.log(`Notificação [${notificationId}] enviada com sucesso para ${tokens.length} dispositivo(s) do usuário ${uid}.`);
    } catch (error) {
      console.error(`Erro ao enviar notificação [${notificationId}] para ${uid}:`, error.code);
      // Aqui você pode registrar ou lidar com tokens inválidos, se quiser
    } finally {
      // Remover notificação da fila
      await notificationSnapshot.ref.remove();
    }
  });
});

console.log("Servidor pronto e ouvindo por novas notificações.");

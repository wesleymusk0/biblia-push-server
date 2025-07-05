// server.js - VERSÃO FINAL CORRIGIDA (Anti-duplicação)

// 1. Importações (sem mudança)
const admin = require("firebase-admin");
const express = require("express");

// 2. Validação e Inicialização do Express (sem mudança)
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

// 3. Inicialização do Firebase Admin (sem mudança)
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

// 4. Lógica Principal: Ouvir o banco de dados (A GRANDE MUDANÇA)
const db = admin.database();

// Listener na raiz '/notifications'. Ele será disparado para cada nova notificação individual.
const notificationsRef = db.ref("/notifications");

// O evento 'child_added' aqui vai disparar uma vez para cada UID (aluno)
notificationsRef.on("child_added", (userSnapshot) => {
  const uid = userSnapshot.key;
  const userNotificationsRef = userSnapshot.ref;

  // Dentro do nó do usuário, escutamos por novas mensagens.
  // Este listener interno garante que só processemos mensagens para este usuário específico.
  userNotificationsRef.on("child_added", async (notificationSnapshot) => {
    const notificationId = notificationSnapshot.key;
    const notificationData = notificationSnapshot.val();

    // Verificação de segurança para não processar duas vezes
    if (!notificationData || notificationData.status === 'processing' || notificationData.status === 'sent') {
      return;
    }

    // Marca a notificação como "em processamento" para evitar que outro processo/thread a pegue.
    await notificationSnapshot.ref.update({ status: 'processing' });

    console.log(`Processando notificação [${notificationId}] para o usuário ${uid}: "${notificationData.message}"`);

    // Busca os tokens FCM do usuário
    const tokensSnapshot = await admin.database().ref(`/users/${uid}/fcmTokens`).get();

    if (!tokensSnapshot.exists()) {
      console.log(`Nenhum token FCM encontrado para ${uid}. Removendo notificação.`);
      await notificationSnapshot.ref.remove();
      return;
    }

    const tokens = Object.keys(tokensSnapshot.val());
    const notificationsToSend = [];

    // Prepara uma promessa de envio para cada token
    tokens.forEach(token => {
        const messagePayload = {
            notification: {
                title: "Biblioteca",
                body: notificationData.message,
            },
            webpush: {
                fcm_options: { link: "https://systematrix.com.br/biblia" },
            },
            token: token
        };
        notificationsToSend.push(admin.messaging().send(messagePayload));
    });

    try {
        // Envia todas as notificações em paralelo
        await Promise.all(notificationsToSend);
        console.log(`Notificação [${notificationId}] enviada com sucesso para ${tokens.length} dispositivo(s) do usuário ${uid}.`);
    } catch (error) {
        console.error(`Erro ao enviar notificação [${notificationId}] para ${uid}:`, error.code);
        // Aqui você pode adicionar lógica para lidar com tokens inválidos, se desejar
    } finally {
        // Remove a notificação da fila após a tentativa de envio
        await notificationSnapshot.ref.remove();
    }
  });
});

console.log("Servidor pronto e ouvindo por novas notificações.");

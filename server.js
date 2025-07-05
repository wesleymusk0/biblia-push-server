// server.js - VERSÃO CORRIGIDA

// 1. Importações
const admin = require("firebase-admin");
const express = require("express");

// 2. Validação das variáveis de ambiente
if (!process.env.FIREBASE_DATABASE_URL) {
  console.error("ERRO: Variável de ambiente FIREBASE_DATABASE_URL não definida.");
  process.exit(1);
}

// 3. Inicialização do Express
const app = express();
app.get("/", (req, res) => {
  res.send("Servidor de notificações BiblIA está ativo!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor web escutando na porta ${PORT}`);
});

// 4. Inicialização do Firebase Admin
try {
  // O Render montará o Secret File neste caminho
  const serviceAccount = require("/etc/secrets/firebase-credentials.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  console.log("Firebase Admin SDK inicializado com sucesso a partir de Secret File.");
} catch (e) {
  console.error("ERRO ao carregar credenciais ou inicializar Firebase:", e.message);
  process.exit(1);
}

// 5. Lógica Principal: Ouvir o banco de dados
const db = admin.database();
// CORREÇÃO: O listener deve estar na raiz '/notifications' para detectar novos UIDs
const notificationsRef = db.ref("/notifications");

// O evento 'child_added' vai disparar quando um novo UID for adicionado em /notifications
notificationsRef.on("child_added", (userNotificationsSnapshot) => {
  const uid = userNotificationsSnapshot.key;

  // Agora, dentro do UID, escutamos por novas mensagens
  userNotificationsSnapshot.ref.on("child_added", async (notificationSnapshot) => {
      const notificationData = notificationSnapshot.val();
      const message = notificationData.message;

      // Ignora se a mensagem já foi processada (se houver essa lógica)
      if (notificationData.status === 'sent') {
          return;
      }

      console.log(`Nova notificação detectada para o usuário ${uid}: "${message}"`);

      // Busca os tokens FCM do usuário
      const tokensSnapshot = await admin.database().ref(`/users/${uid}/fcmTokens`).get();

      if (!tokensSnapshot.exists()) {
        console.log(`Nenhum token FCM encontrado para o usuário ${uid}.`);
        // Remove a notificação para não processar de novo
        notificationSnapshot.ref.remove();
        return;
      }

      const tokens = Object.keys(tokensSnapshot.val());

      const payload = {
        notification: {
          title: "BiblIA - Sua Biblioteca",
          body: message,
          //icon: '/icone.png' // Lembre-se de adicionar este ícone à raiz do seu site
        },
      };

      console.log(`Enviando notificação para ${tokens.length} dispositivo(s).`);

      try {
        await admin.messaging().sendToDevice(tokens, payload);
        console.log(`Notificação enviada com sucesso para ${uid}.`);
        // Remove a notificação do banco de dados após processá-la com sucesso
        notificationSnapshot.ref.remove();
      } catch (error) {
        console.error("Erro ao enviar notificação:", error);
      }
  });
});

// server.js - VERSÃO FINAL E ROBUSTA (usando API HTTP v1)

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

// 5. Função de Envio de Notificação (Refatorada)
async function sendNotification(uid, message) {
  console.log(`Processando notificação para o usuário ${uid}: "${message}"`);

  // Busca os tokens FCM do usuário
  const tokensSnapshot = await admin.database().ref(`/users/${uid}/fcmTokens`).get();

  if (!tokensSnapshot.exists()) {
    console.log(`Nenhum token FCM encontrado para o usuário ${uid}.`);
    return;
  }

  const tokens = Object.keys(tokensSnapshot.val());
  
  if (tokens.length === 0) {
      console.log(`Lista de tokens vazia para o usuário ${uid}.`);
      return;
  }

  // Monta a mensagem para a API HTTP v1
  // A principal diferença é que o alvo (token) vai dentro do objeto da mensagem.
  const messagePayload = {
    notification: {
      title: "BiblIA - Sua Biblioteca",
      body: message,
    },
    // Opcional: Adicionar um ícone. Certifique-se que o arquivo /icone.png existe no seu site.
    webpush: {
        fcm_options: {
            link: "https://systematrix.com.br/biblia" // URL para abrir ao clicar na notificação
        }
    },
    // A chave "token" especifica o destinatário
    token: tokens[0] // << Enviando para o primeiro token encontrado. Para enviar para vários, precisa de um loop.
  };

  console.log(`Enviando notificação para o token: ${tokens[0]}`);

  try {
    // USA A FUNÇÃO send() EM VEZ DE sendToDevice()
    const response = await admin.messaging().send(messagePayload);
    console.log(`Notificação enviada com sucesso para ${uid}. Response:`, response);
  } catch (error) {
    // Lógica para tratar erros comuns da API v1
    if (error.code === 'messaging/registration-token-not-registered') {
      console.log(`Token inválido: ${tokens[0]}. Removendo do banco de dados.`);
      // Remove o token inválido
      await admin.database().ref(`/users/${uid}/fcmTokens/${tokens[0]}`).remove();
    } else {
       console.error("Erro ao enviar notificação (API v1):", error);
    }
  }
}


// 6. Lógica Principal: Ouvir o banco de dados
const db = admin.database();
const notificationsRef = db.ref("/notifications");

notificationsRef.on("child_added", (userNotificationsSnapshot) => {
  const uid = userNotificationsSnapshot.key;

  userNotificationsSnapshot.ref.on("child_added", (notificationSnapshot) => {
      const notificationData = notificationSnapshot.val();
      const message = notificationData.message;

      // Chama a função de envio e depois remove o registro da fila
      sendNotification(uid, message)
        .then(() => {
          // Remove a notificação da fila após a tentativa de envio (sucesso ou falha)
          notificationSnapshot.ref.remove();
        });
  });
});

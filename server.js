// 1. Importações
const admin = require("firebase-admin");
const express = require("express");

// 2. Validação das variáveis de ambiente
if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
  console.error("ERRO: Variáveis de ambiente FIREBASE_SERVICE_ACCOUNT ou FIREBASE_DATABASE_URL não definidas.");
  process.exit(1); // Encerra o processo se as variáveis não existirem
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
} catch(e) {
    console.error("ERRO ao carregar credenciais ou inicializar Firebase:", e.message);
    process.exit(1);
}

// 5. Lógica Principal: Ouvir o banco de dados
const db = admin.database();
const notificationsRef = db.ref("/notifications/{uid}");

// Escuta por NOVOS filhos (novas notificações) em /notifications/{uid}
notificationsRef.on("child_added", async (snapshot, prevChildKey) => {
  const notificationContext = snapshot.ref.parent.key; // O UID do usuário
  const notificationSnapshot = snapshot.child(snapshot.key); // A notificação em si

  const uid = notificationContext;
  const notificationData = snapshot.val();
  const message = notificationData.message;

  console.log(`Nova notificação detectada para o usuário ${uid}: "${message}"`);

  // Busca os tokens FCM do usuário
  const tokensSnapshot = await admin
    .database()
    .ref(`/users/${uid}/fcmTokens`)
    .get();

  if (!tokensSnapshot.exists()) {
    console.log(`Nenhum token FCM encontrado para o usuário ${uid}.`);
    snapshot.ref.remove(); // Limpa a notificação para não processar de novo
    return;
  }

  const tokens = Object.keys(tokensSnapshot.val());

  const payload = {
    notification: {
      title: "BiblIA - Sua Biblioteca",
      body: message,
      //icon: "https://cdn.glitch.global/0b329dbe-9c17-483c-9b7c-7221d8add22a/biblia-icon.png?v=1682705971168" // Exemplo de ícone
    },
  };

  console.log(`Enviando notificação para ${tokens.length} dispositivo(s).`);

  try {
    const response = await admin.messaging().sendToDevice(tokens, payload);
    // Lógica para limpar tokens inválidos (opcional, mas recomendado)
    const tokensToRemove = [];
    response.results.forEach((result, index) => {
      const error = result.error;
      if (error) {
        if (error.code === "messaging/registration-token-not-registered") {
          tokensToRemove.push(tokensSnapshot.ref.child(tokens[index]).remove());
        }
      }
    });
    await Promise.all(tokensToRemove);
  } catch (error) {
    console.error("Erro ao enviar notificação:", error);
  } finally {
    // Remove a notificação do banco de dados após processá-la
    snapshot.ref.remove();
  }
});

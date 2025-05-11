// Importando o express
const express = require('express');
const path = require('path');
const app = express();

// Configurando a porta do servidor
const port = process.env.PORT;

// Configurando o Express para servir os arquivos estáticos da build do React
app.use(express.static(path.join(__dirname, 'build')));

// Configuração de fallback para o React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Iniciando o servidor
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

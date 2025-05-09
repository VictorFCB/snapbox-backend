# Usando a imagem oficial do Node.js
FROM node:18-alpine

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar os arquivos de package.json e package-lock.json para o container
COPY ./package.json ./package-lock.json ./

# Instalar as dependências
RUN npm install

# Copiar o restante do código do backend
COPY . .

# Expor a porta 3010 (padrão para o backend)
EXPOSE 3010

# Comando para rodar o servidor Express
CMD ["node", "index.js"]

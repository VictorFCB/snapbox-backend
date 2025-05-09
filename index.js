import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import supabase from './supabase.js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';


dotenv.config({ path: '.env.dev' });

const app = express();
const PORT = process.env.PORT || 3010;
const BUCKET_NAME = 'images';

app.use(cors({ origin: process.env.FRONTEND_URL}));
app.use(express.json());

// Rota para login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  try {
    // Tente usar a função de login do Supabase para autenticação
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      // Se houver erro no login, retorne o erro para o cliente
      return res.status(401).json({ error: 'Email ou senha incorretos.' });
    }

    // Se o login for bem-sucedido, retorne a sessão e os dados do usuário
    res.status(200).json({
      message: 'Login bem-sucedido!',
      session: data.session,  // Retorne a sessão aqui
      user: data.user,        // Retorne os dados do usuário
    });
  } catch (error) {
    console.error('Erro ao autenticar usuário:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota de registro
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  console.log('Body recebido no backend:', req.body);  // Verifique o conteúdo do corpo

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  }

  try {
    // Cria o usuário no Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error('Erro ao criar usuário no Supabase Auth:', error);
      return res.status(400).json({ error: error.message || 'Erro ao criar usuário no Supabase Auth.' });
    }

    console.log('Usuário criado no Supabase Auth:', data.user);

    // Cria o registro do usuário na tabela 'users' após o cadastro no Supabase Auth
    const { error: insertError } = await supabase
      .from('users')
      .insert([
        {
          id: uuidv4(),            // Gerando UUID para o novo usuário
          name,
          email,
          user_id: data.user.id,   // Referência ao user_id do Supabase Auth
        },
      ]);

    if (insertError) {
      console.error('Erro ao salvar usuário na tabela users:', insertError);
      return res.status(500).json({ error: 'Erro ao salvar usuário no banco de dados.' });
    }

    // Se tudo ocorreu bem, envia a resposta de sucesso
    res.status(201).json({
      message: 'Cadastro bem-sucedido!',
      user: {
        id: data.user.id,
        email: data.user.email,
        name,
      },
      session: data.session,
    });
  } catch (error) {
    console.error('Erro no processo de registro:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});


// Configuração do Multer para upload de arquivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },  // Limite de 25MB por arquivo
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

app.post('/parametrize-url', upload.single('image'), async (req, res) => {
  try {
    // Receber a URL base e os parâmetros
    const { baseUrl, params } = req.body;

    // Parse a string JSON para objeto
    const paramsObj = JSON.parse(params);

    console.log('Base URL:', baseUrl);
    console.log('Parâmetros:', paramsObj);

    res.json({ parametrizedUrl: baseUrl + '?' + new URLSearchParams(paramsObj).toString() });
  } catch (error) {
    console.error('Erro ao processar a solicitação:', error);
    res.status(400).json({ error: 'Erro ao parametrizar a URL' });
  }
});

// Rota para salvar URL na tabela urls_snapbox
app.post('/save-url', async (req, res) => {
  try {
    const { name, url, image } = req.body;

    // Verifica se os campos obrigatórios estão presentes
    if (!name || !url) {
      return res.status(400).json({ error: 'Nome e URL são obrigatórios' });
    }

    // Gerando o UUID manualmente no backend
    const id = uuidv4();

    // Inserir dados na tabela urls_snapbox com o UUID gerado
    const { data, error } = await supabase
      .from('urls_snapbox')
      .insert([
        {
          id: id,  // Passando o UUID gerado para o campo id
          name: name,
          url: url,
          image: image || null,  // Imagem é opcional
        }
      ])
      .select(); // Isso garante que os dados inseridos (incluindo o UUID) sejam retornados

    if (error) {
      console.error('Erro ao salvar URL no Supabase:', error);
      return res.status(500).json({ error: 'Erro ao salvar URL no banco de dados' });
    }

    // Retorna os dados inseridos, incluindo o UUID gerado manualmente
    res.status(201).json({
      ...data[0],  // Inclui todos os dados retornados (incluindo o UUID)
      id: id       // Garante que o UUID gerado apareça explicitamente
    });
  } catch (error) {
    console.error('Erro ao salvar URL:', error);
    res.status(500).json({ error: 'Erro ao salvar URL' });
  }
});

// Atualizar nome da campanha
app.put('/urls/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Nome é obrigatório.' });
  }

  try {
    const { data, error } = await supabase
      .from('urls_snapbox')
      .update({ name })
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro ao atualizar nome:', error);
      return res.status(500).json({ error: 'Erro ao atualizar nome da campanha.' });
    }

    res.status(200).json(data[0]);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});


// Rota para buscar URLs salvas
app.get('/urls', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('urls_snapbox')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar URLs salvas:', error);
      return res.status(500).json({ error: 'Erro ao buscar URLs' });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('Erro geral ao buscar URLs:', err);
    res.status(500).json({ error: 'Erro ao buscar URLs' });
  }
});


// Rota para deletar uma URL salva
app.delete('/urls/:id', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from('urls_snapbox')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Erro ao excluir URL:', error);
    return res.status(500).json({ error: 'Erro ao excluir a URL' });
  }

  res.status(200).json({ success: true });
});


// Listar arquivos
app.get('/files', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar arquivos' });
  }
});

// Upload de arquivo
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Nenhum arquivo enviado');

    const { originalname, mimetype, buffer } = req.file;
    const fileExt = originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExt}`;

    // Fazendo upload para o Supabase
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(`public/${fileName}`, buffer, {
        contentType: mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Obtendo URL pública do arquivo
    const { data: { publicUrl } } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(`public/${fileName}`);

    console.log('URL pública do arquivo:', publicUrl);  // Log da URL gerada

    // Inserindo no banco de dados
    const { data, error: dbError } = await supabase
      .from('uploads')
      .insert([{
        name: originalname,
        path: `public/${fileName}`,
        url: publicUrl,  // Certificando-se de que a URL está sendo salva
        mimetype,
        size: req.file.size
      }])
      .select();

    if (dbError) throw dbError;

    res.status(201).json(data[0]);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Erro ao fazer upload' });
  }
});

// Deletar arquivo
app.delete('/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { path } = req.body;

    const { error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (storageError) throw storageError;

    const { error: dbError } = await supabase
      .from('uploads')
      .delete()
      .eq('id', id);

    if (dbError) throw dbError;

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message || 'Erro ao excluir arquivo' });
  }
});

// Enviar email com HTML
app.post('/send-email', async (req, res) => {
  const { to, html } = req.body;

  if (!to || !html) {
    return res.status(400).json({ error: 'Campos "to" e "html" são obrigatórios.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"SnapBox" <${process.env.EMAIL_USER}>`,
      to: Array.isArray(to) ? to.join(',') : to,
      subject: 'Software desenvolvido pela FCB Health',
      html,
    });

    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    res.status(500).json({ error: 'Erro ao enviar e-mail' });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

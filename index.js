import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import supabase from './supabase.js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import moment from 'moment-timezone';



dotenv.config({ path: '.env.dev' });

const app = express();
const PORT = process.env.PORT;
const BUCKET_NAME = 'images';
const verificationCodes = new Map(); // Armazena códigos temporariamente (ideal seria usar Redis ou DB com expiração)
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';


app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// Definir a cron job para rodar todos os dias à meia-noite (00:00)
cron.schedule('0 0 * * *', async () => {
  try {
    const { error } = await supabase
      .from('user_activity')
      .delete()
      .lt('login_time', new Date().toISOString());

    if (error) {
      console.error('Erro ao apagar os dados de user_activity:', error.message);
    } else {
      console.log('Dados de user_activity apagados com sucesso.');
    }
  } catch (err) {
    console.error('Erro ao agendar a tarefa de limpeza:', err);
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

// Rota para adicionar um admin
app.post('/add-admin', async (req, res) => {
  const { email } = req.body;

  // Valida se o e-mail termina com @fcbhealth.com
  if (!email.endsWith('@fcbhealth.com')) {
    return res.status(400).json({ error: 'E-mail deve ser da organização (@fcbhealth.com)' });
  }

  // Inserir o e-mail na tabela admins
  const { data, error } = await supabase
    .from('admins')
    .insert([{ email }]);

  if (error) {
    return res.status(500).json({ error: 'Erro ao adicionar administrador' });
  }

  res.status(200).json({ success: true, data });
});


app.post('/logout', async (req, res) => {
  const { email, most_viewed_path } = req.body;

  const { data: lastSession, error } = await supabase
    .from('user_activity')
    .select('*')
    .eq('email', email)
    .order('login_time', { ascending: false })
    .limit(1);

  if (error || !lastSession.length) {
    return res.status(404).json({ error: 'Sessão não encontrada.' });
  }

  const logoutTime = moment().tz('America/Sao_Paulo').format();
  const loginTime = moment(lastSession[0].login_time).tz('America/Sao_Paulo');
  const sessionDuration = Math.floor((moment(logoutTime) - loginTime) / 1000);

  const { error: updateError } = await supabase
    .from('user_activity')
    .update({
      logout_time: logoutTime,
      session_duration: sessionDuration,
      most_viewed_path: most_viewed_path || '/', // Garante um valor padrão
    })
    .eq('id', lastSession[0].id);

  if (updateError) return res.status(500).json({ error: 'Erro ao atualizar sessão.' });

  return res.json({ success: true });
});

app.get('/admin-stats', async (req, res) => {
  const { data, error } = await supabase
    .from('user_activity')
    .select('*');

  if (error) return res.status(500).json({ error: 'Erro ao buscar atividades' });

  const onlineUsers = data.filter(user => !user.logout_time).length;
  const totalUsers = new Set(data.map(u => u.email)).size;

  const sessionByUser = data.reduce((acc, curr) => {
    acc[curr.email] = (acc[curr.email] || 0) + (curr.session_duration || 0);
    return acc;
  }, {});

  const mostActiveUser = Object.entries(sessionByUser).sort((a, b) => b[1] - a[1])[0];

  const enriched = data.map(log => {
    return {
      ...log,
      session_duration_minutes: Math.floor((log.session_duration || 0) / 60),
      // Garante que most_viewed_path seja incluído mesmo se for null
      most_viewed_path: log.most_viewed_path || null
    };
  });

  res.json({
    total_users: totalUsers,
    online_users: onlineUsers,
    most_active_user: {
      email: mostActiveUser?.[0] || '',
      session_duration_minutes: Math.floor((mostActiveUser?.[1] || 0) / 60),
    },
    user_logs: enriched,
  });
});

// Rota para verificar código
app.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'E-mail e código são obrigatórios.'
      });
    }

    // Verifica se o código de verificação enviado é válido
    const storedCode = verificationCodes.get(email);

    if (!storedCode) {
      return res.status(400).json({
        success: false,
        error: 'Código expirado ou não encontrado.'
      });
    }

    if (storedCode !== code) {
      return res.status(400).json({
        success: false,
        error: 'Código incorreto.'
      });
    }

    // Código correto, remover código armazenado
    verificationCodes.delete(email);

    // Verificar se o e-mail pertence a um admin
    const { data: adminData, error: adminError } = await supabase
      .from('admins')
      .select('email')
      .eq('email', email);

    if (adminError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao verificar admin.'
      });
    }

    const isAdmin = adminData.length > 0; // Se o e-mail está na tabela de admins

    // Gerar token JWT, incluindo o campo isAdmin
    const token = jwt.sign({ email, isAdmin }, JWT_SECRET, { expiresIn: '1h' });

    // Registrar a atividade de login
    const loginTime = moment().tz('America/Sao_Paulo').format();

    const { error: dbError } = await supabase
      .from('user_activity')
      .insert([{ email, login_time: loginTime }]);

    if (dbError) {
      console.error('Erro ao registrar login no Supabase:', dbError.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao registrar atividade de login.'
      });
    }

    // Resposta de sucesso com o token e o status de admin
    return res.status(200).json({ success: true, email, token, isAdmin });

  } catch (err) {
    console.error('Erro no endpoint /verify-code:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor.'
    });
  }
});


app.post('/send-verification-code', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.endsWith('@fcbhealth.com')) {
    return res.status(400).json({ success: false, error: 'E-mail inválido ou não autorizado' });
  }

  // Gera um código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // Armazena temporariamente (ideal seria Redis ou banco com TTL)
  verificationCodes.set(email, code);
  setTimeout(() => verificationCodes.delete(email), 5 * 60 * 1000); // expira em 5 minutos

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

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 40px; text-align: center;">
        <h2 style="color: #333;">Olá!</h2>
        <p style="font-size: 16px; color: #555;">
          Seu código de verificação para acessar o SnapBox é:
        </p>
        <div style="margin: 30px 0;">
          <span style="
            font-size: 48px;
            font-weight: bold;
            color: #2c3e50;
            background: #ecf0f1;
            padding: 20px 40px;
            border-radius: 10px;
            display: inline-block;
            letter-spacing: 10px;
          ">${code}</span>
        </div>
        <p style="font-size: 14px; color: #999;">Este código expira em 5 minutos.</p>
        <hr style="margin-top: 40px;" />
        <p style="font-size: 12px; color: #ccc;">SnapBox &copy; ${new Date().getFullYear()} | Desenvolvido pela FCB Health</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"SnapBox" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Seu código de verificação • SnapBox',
      html: htmlContent,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao enviar e-mail' });
  }
});

app.post('/parametrize-url', upload.single('image'), async (req, res) => {
  try {
    // Receber a URL base e os parâmetros
    const { baseUrl, params } = req.body;

    // Parse a string JSON para objeto
    const paramsObj = JSON.parse(params);

    res.json({ parametrizedUrl: baseUrl + '?' + new URLSearchParams(paramsObj).toString() });
  } catch (error) {
    res.status(400).json({ error: 'Erro ao parametrizar a URL' });
  }
});

// Rota para salvar URL na tabela urls_snapbox
app.post('/save-url', upload.single('image'), async (req, res) => {
  try {
    const { name, url } = req.body;

    // Se uma imagem foi carregada, fazer o upload para o Supabase Storage
    let imageUrl = null;
    if (req.file) {
      const { originalname, mimetype, buffer } = req.file;
      const fileExt = originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;

      // Fazendo upload da imagem para o Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`public/${fileName}`, buffer, {
          contentType: mimetype,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      // Obtendo URL pública da imagem carregada
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(`public/${fileName}`);

      imageUrl = publicUrl; // Armazena a URL pública da imagem
    }

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
          image: imageUrl || null,  // Armazenando a URL da imagem ou null
        }
      ])
      .select(); // Isso garante que os dados inseridos (incluindo o UUID) sejam retornados

    if (error) {
      return res.status(500).json({ error: 'Erro ao salvar URL no banco de dados' });
    }

    // Retorna os dados inseridos, incluindo o UUID gerado
    res.status(201).json({
      ...data[0],  // Inclui todos os dados retornados (incluindo o UUID)
      id: id       // Garante que o UUID gerado apareça explicitamente
    });
  } catch (error) {
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
      return res.status(500).json({ error: 'Erro ao atualizar nome da campanha.' });
    }

    res.status(200).json(data[0]);
  } catch (err) {
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
      return res.status(500).json({ error: 'Erro ao buscar URLs' });
    }

    res.status(200).json(data);
  } catch (err) {
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
    res.status(500).json({ error: 'Erro ao enviar e-mail' });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

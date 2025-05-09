import { createClient } from '@supabase/supabase-js';

// Configuração com validação de variáveis de ambiente
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Variáveis de ambiente SUPABASE_URL e SUPABASE_KEY são obrigatórias!'
  );
}

// Criação do cliente com configurações otimizadas
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false, // Recomendado para apps que não usam auth
    autoRefreshToken: false
  },
  global: {
    headers: {
      'X-Application-Name': 'SnapBox'
    }
  }
});

// Funções úteis para o Storage
export const storageService = {
  /**
   * Faz upload de arquivo para o Storage
   * @param {string} bucketName 
   * @param {string} filePath 
   * @param {File} file 
   * @returns {Promise<{url: string, path: string}>}
   */
  uploadFile: async (bucketName, filePath, file) => {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        cacheControl: '3600', // 1 hora de cache
        upsert: false,
        contentType: file.type
      });

    if (error) {
      console.error('Erro no upload:', error);
      throw new Error(error.message);
    }

    return {
      path: data.path,
      url: getPublicUrl(bucketName, data.path)
    };
  },

  /**
   * Obtém URL pública de um arquivo
   * @param {string} bucketName 
   * @param {string} filePath 
   * @returns {string}
   */
  getPublicUrl: (bucketName, filePath) => {
    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath, {
        download: false
      });
    return publicUrl;
  },

  /**
   * Gera URL assinada temporária
   * @param {string} bucketName 
   * @param {string} filePath 
   * @param {number} expiresIn (segundos)
   * @returns {Promise<string>}
   */
  getSignedUrl: async (bucketName, filePath, expiresIn = 3600) => {
    const { data: { signedUrl }, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(filePath, expiresIn);

    if (error) {
      console.error('Erro ao gerar URL assinada:', error);
      throw new Error(error.message);
    }

    return signedUrl;
  }
};

export default supabase;
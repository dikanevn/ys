import { Raydium, TxVersion, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2'
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import bs58 from 'bs58'
import dotenv from 'dotenv';

dotenv.config();

// Считываем секретный ключ из переменной окружения,
// поддерживается два формата: base58-строка или JSON-массив чисел.
const walletSecret = process.env.WALLET_SECRET;
if (!walletSecret) {
  throw new Error("WALLET_SECRET не определён в переменных окружения!");
}
let ownerKeypair: Keypair;
try {
  if (walletSecret.trim().startsWith('[')) {
    // Если ключ задан как JSON-массив чисел
    const secretArray = JSON.parse(walletSecret);
    ownerKeypair = Keypair.fromSecretKey(new Uint8Array(secretArray));
  } else {
    // Если ключ задан как строка в формате base58
    ownerKeypair = Keypair.fromSecretKey(bs58.decode(walletSecret));
  }
} catch (error) {
  throw new Error("Ошибка при обработке WALLET_SECRET: " + error);
}
export const owner: Keypair = ownerKeypair;

// Считываем URL RPC из переменной окружения
const rpcEndpoint = process.env.RPC_ENDPOINT;
if (!rpcEndpoint) {
  throw new Error("RPC_ENDPOINT не определён в переменных окружения!");
}
export const connection = new Connection(rpcEndpoint, 'confirmed');

// Выбирайте версию транзакций: TxVersion.V0 или TxVersion.LEGACY
export const txVersion = TxVersion.V0

// Укажите, с каким кластером вы работаете: 'mainnet' или 'devnet'
const cluster = 'mainnet'

// Экземпляр Raydium (инициализируется один раз)
let raydium: Raydium | undefined

export const initSdk = async (params?: { loadToken?: boolean }) => {
  if (raydium) return raydium

  if (connection.rpcEndpoint === clusterApiUrl('mainnet-beta')) {
    console.warn('Использование бесплатного RPC узла может вызвать неожиданные ошибки. Рекомендуется использовать платный RPC.')
  }
  console.log(`Подключение к RPC ${connection.rpcEndpoint} в кластере ${cluster}`)

  raydium = await Raydium.load({
    owner,
    connection,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: !params?.loadToken,
    blockhashCommitment: 'finalized',
    // Если нужно указать свои URL для API, раскомментируйте и замените значение BASE_HOST:
    // urlConfigs: {
    //   BASE_HOST: '<API_HOST>',
    // },
  })

  /**
   * По умолчанию SDK автоматически обновляет данные о токен-аккаунтах при изменении SOL-баланса.
   * Если вам необходимо самостоятельно получать и обновлять эти данные, воспользуйтесь функцией fetchTokenAccountData.
   *
   * Пример:
   * raydium.account.updateTokenAccount(await fetchTokenAccountData())
   * connection.onAccountChange(owner.publicKey, async () => {
   *   raydium!.account.updateTokenAccount(await fetchTokenAccountData())
   * })
   */

  return raydium
}

export const fetchTokenAccountData = async () => {
  const solAccountResp = await connection.getAccountInfo(owner.publicKey)
  const tokenAccountResp = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_PROGRAM_ID })
  const token2022Req = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_2022_PROGRAM_ID })

  const tokenAccountData = parseTokenAccountResp({
    owner: owner.publicKey,
    solAccountResp,
    tokenAccountResp: {
      context: tokenAccountResp.context,
      value: [...tokenAccountResp.value, ...token2022Req.value],
    },
  })

  return tokenAccountData
}

// Если требуется настройка gRPC, замените следующие параметры:
export const grpcUrl = '<YOUR_GRPC_URL>'
export const grpcToken = '<YOUR_GRPC_TOKEN>' 
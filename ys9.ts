import BN from 'bn.js'
import { PublicKey } from '@solana/web3.js'
import { initSdk, txVersion } from './config'
// Импортируем функцию для вычисления PDA пула.
// Функция getCpmmPdaPoolId принимает следующие параметры:
// программный ID пула, адрес Amm Config, mintA и mintB.
import { getCpmmPdaPoolId, CREATE_CPMM_POOL_PROGRAM } from '@raydium-io/raydium-sdk-v2'

async function main() {
  // Инициализируем Raydium SDK с загрузкой информации о токенах
  const raydium = await initSdk({ loadToken: true })

  // Получаем информацию о токенах по их адресам
  const mintAInfo = await raydium.token.getTokenInfo(
    '3AjYWGv3BVs1o6ZzSipNnoDnjC1d9PUsCG2MKGuryqxo'
  )
  const mintBInfo = await raydium.token.getTokenInfo(
    'So11111111111111111111111111111111111111112'
  )

  // Указываем адрес Amm Config, который используется в ys7.ts
  const ammConfigAddress = new PublicKey('G95xxie3XbkCqtE39GgQ9Ggc7xBC8Uceve7HFDEFApkc')

  // 1. Вычисляем PDA пула с обычным порядком токенов (A → B)
  const { publicKey: poolIdAtoB } = getCpmmPdaPoolId(
    CREATE_CPMM_POOL_PROGRAM,
    ammConfigAddress,
    new PublicKey(mintAInfo.address),
    new PublicKey(mintBInfo.address)
  )
  console.log('Computed CPmm Pool PDA (A → B):', poolIdAtoB.toBase58())

  // 2. Вычисляем PDA пула с обратным порядком токенов (B → A)
  const { publicKey: poolIdBtoA } = getCpmmPdaPoolId(
    CREATE_CPMM_POOL_PROGRAM,
    ammConfigAddress,
    new PublicKey(mintBInfo.address),
    new PublicKey(mintAInfo.address)
  )
  console.log('Computed CPmm Pool PDA (B → A):', poolIdBtoA.toBase58())

  // 3. Третий вариант: сортировка адресов токенов согласно правилам
  // (например, по лексикографическому возрастанию строки Base58)
  const pubA = new PublicKey(mintAInfo.address)
  const pubB = new PublicKey(mintBInfo.address)
  let sortedToken0: PublicKey, sortedToken1: PublicKey

  if (Buffer.compare(pubA.toBuffer(), pubB.toBuffer()) < 0) {
    sortedToken0 = pubA
    sortedToken1 = pubB
  } else {
    sortedToken0 = pubB
    sortedToken1 = pubA
  }
  const { publicKey: poolIdSorted } = getCpmmPdaPoolId(
    CREATE_CPMM_POOL_PROGRAM,
    ammConfigAddress,
    sortedToken0,
    sortedToken1
  )
  console.log('Computed CPmm Pool PDA (Sorted):', poolIdSorted.toBase58())

  // Дополнительно можно получить информацию о пуле через RPC для всех вариантов,
  // чтобы убедиться, что адреса вычислены корректно.
  try {
    const poolDataAtoB = await raydium.cpmm.getPoolInfoFromRpc(poolIdAtoB.toBase58())
    console.log('Pool Info (A → B):', poolDataAtoB.poolInfo)
  } catch (error) {
    console.error('Ошибка при получении Pool Info (A → B):', error)
  }

  try {
    const poolDataBtoA = await raydium.cpmm.getPoolInfoFromRpc(poolIdBtoA.toBase58())
    console.log('Pool Info (B → A):', poolDataBtoA.poolInfo)
  } catch (error) {
    console.error('Ошибка при получении Pool Info (B → A):', error)
  }

  try {
    const poolDataSorted = await raydium.cpmm.getPoolInfoFromRpc(poolIdSorted.toBase58())
    console.log('Pool Info (Sorted):', poolDataSorted.poolInfo)
  } catch (error) {
    console.error('Ошибка при получении Pool Info (Sorted):', error)
  }

  process.exit(0)
}

main().catch((error) => {
  console.error('Ошибка в ys9.ts:', error)
  process.exit(1)
}) 
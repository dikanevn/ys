import BN from 'bn.js'
import { PublicKey } from '@solana/web3.js'
import { initSdk, txVersion, owner } from './config'
// Импортируем функцию для вычисления PDA пула.
// Функция getCpmmPdaPoolId принимает следующие параметры:
// программный ID пула, адрес Amm Config, mintA и mintB.
import { getCpmmPdaPoolId, CREATE_CPMM_POOL_PROGRAM, CurveCalculator } from '@raydium-io/raydium-sdk-v2'
import { getAssociatedTokenAddress } from '@solana/spl-token'

async function main() {
  // Инициализируем Raydium SDK с загрузкой информации о токенах
  const raydium = await initSdk({ loadToken: true })

  // Получаем информацию о токенах по их адресам
  const mintAInfo = await raydium.token.getTokenInfo(
    '7CT88WZHKyCF6bhYrqmTaLoxDxwFBiTWLQ1Uebsh3ABW'
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
    console.log('Пул (A → B) получен')
  } catch (error) {
    console.error('Ошибка')
  }

  try {
    const poolDataBtoA = await raydium.cpmm.getPoolInfoFromRpc(poolIdBtoA.toBase58())
    console.log('Пул (B → A) получен')
  } catch (error) {
    console.error('Ошибка')
  }

  let sortedPoolData: any;
  try {
    sortedPoolData = await raydium.cpmm.getPoolInfoFromRpc(poolIdSorted.toBase58())
    console.log('Пул (Sorted) получен')
  } catch (error) {
    console.error('Ошибка')
  }

  // Если данные отсортированного пула получены, проверяем баланс токена A и выполняем свап 10% от баланса
  if (sortedPoolData) {
    try {
      // Получаем ассоциированный токен-аккаунт для токена A
      const tokenAAccount = await getAssociatedTokenAddress(
        new PublicKey(mintAInfo.address),
        owner.publicKey
      )
      
      // Проверяем, существует ли аккаунт для токена A
      const tokenAccountInfo = await raydium.connection.getAccountInfo(tokenAAccount)
      if (!tokenAccountInfo) {
        console.error("Не найден associated token account для токена A. Пожалуйста, создайте его.")
        process.exit(1)
      }
      
      // Запрашиваем баланс токена A
      const balanceInfo = await raydium.connection.getTokenAccountBalance(tokenAAccount)
      const tokenABalanceRaw = new BN(balanceInfo.value.amount)
      const sellAmount = tokenABalanceRaw.div(new BN(90))  // 90% от баланса
      
      if (sellAmount.isZero()) {
        console.error("Недостаточно средств для свопа")
      } else {
        console.log("10% токенов A для свопа:", sellAmount.toString())
        
        // Определяем направление свопа для сортированной пары:
        // Если sortedToken0 равен адресу токена A, значит baseIn = true, иначе false.
        const baseIn = sortedToken0.equals(new PublicKey(mintAInfo.address))
        
        // Вычисляем swapResult с помощью CurveCalculator.swap()
        const swapResult = CurveCalculator.swap(
          sellAmount,
          baseIn
            ? sortedPoolData.rpcData.baseReserve
            : sortedPoolData.rpcData.quoteReserve,
          baseIn
            ? sortedPoolData.rpcData.quoteReserve
            : sortedPoolData.rpcData.baseReserve,
          sortedPoolData.rpcData.configInfo.tradeFeeRate
        )
        
        const swapParams = {
          poolInfo: sortedPoolData.poolInfo,
          poolKeys: sortedPoolData.poolKeys,
          inputAmount: sellAmount,
          slippage: 0.20, // 1% допустимой просадки
          baseIn,
          ownerInfo: { useSOLBalance: true },
          txVersion,
          swapResult, // добавляем вычисленный swapResult
        }
        const { execute } = await raydium.cpmm.swap(swapParams)
        const { txId } = await execute({ sendAndConfirm: true })
        console.log("Обмен выполнен успешно, txId:", txId)
      }
    } catch (error) {
      console.error("Ошибка при выполнении свопа", error)
    }
  }
  
  process.exit(0)
}

main().catch((error) => {
  console.error('Ошибка в ys10.ts:', error)
  process.exit(1)
}) 
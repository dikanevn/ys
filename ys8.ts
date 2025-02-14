import BN from 'bn.js'
import { PublicKey } from '@solana/web3.js'
import { initSdk, txVersion } from './config'

async function main() {
  // Инициализируем Raydium SDK с загрузкой информации о токенах
  const raydium = await initSdk({ loadToken: true })

  // Получаем информацию о токенах по их адресам
  // Токен A – адрес, который вы использовали ранее (например, может быть вашим базовым токеном)
  const mintA = await raydium.token.getTokenInfo(
    '9aGQqWqHSeyVtQXNkPuTUZ3aW288fjeRLQcMmjniivEf'
  )
  // Токен B – например, обёрнутый SOL
  const mintB = await raydium.token.getTokenInfo(
    'So11111111111111111111111111111111111111112'
  )

  // Адрес состояния пула, который вы получили при создании пула (например, #4 - Pool State)
  // Замените строку ниже на актуальный адрес вашего пула
  const poolStateAddress = new PublicKey('53no47CXhNBfzS5NFRxYTW266LQ2e5Wqn8KaE7FAoNMS')

  // Получаем данные пула (poolInfo и poolKeys) через RPC
  const poolData = await raydium.cpmm.getPoolInfoFromRpc(poolStateAddress.toBase58())
  const poolInfo = poolData.poolInfo
  const poolKeys = poolData.poolKeys

  // Определяем направление свопа: если mintA совпадает с poolInfo.mintA, значит мы продаем токен A
  const baseIn = mintA.address === poolInfo.mintA.address
  if (!baseIn) {
    console.error('Token A не совпадает с базовым токеном пула. Проверьте адреса.')
    process.exit(1)
  }

  // Рассчитываем сумму для обмена: 0.01 токена A.
  // Для этого учитываем десятичное представление токена (например, если decimals = 9, то 0.01 * 1e9 = 10^7)
  const factor = Math.pow(10, mintA.decimals)
  const inputAmount = new BN(Math.floor(0.01 * factor))
  console.log(`Обмен: продаем ${inputAmount.toString()} (в "сырая единицах") токена ${mintA.symbol}`)

  // Вызываем метод swap из SDK.
  // Здесь указаны параметры:
  // - poolInfo и poolKeys – полученные данные пула
  // - inputAmount – рассчитанная сумма для обмена
  // - slippage – допустимая просадка (например, 1% равняется 0.01)
  // - baseIn – направление обмена (true: продаем токен A)
  // - ownerInfo – используем баланс SOL для оплаты комиссий
  // - txVersion – версия транзакции из конфигурации
  const { execute } = await raydium.cpmm.swap({
    poolInfo,
    poolKeys,
    inputAmount,
    slippage: 0.01, // 1% допустимой просадки
    baseIn,       // продаем токен A
    ownerInfo: { useSOLBalance: true },
    txVersion,
  })

  // Отправляем транзакцию и ожидаем подтверждения
  const { txId } = await execute({ sendAndConfirm: true })
  console.log('Обмен выполнен успешно', { txId })

  process.exit(0)
}

main().catch((error) => {
  console.error('Ошибка при обмене:', error)
  process.exit(1)
}) 
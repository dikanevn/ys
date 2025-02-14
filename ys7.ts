import {
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  // При необходимости добавьте DEVNET_PROGRAM_ID и getCpmmPdaAmmConfigId, если планируете работать с devnet
} from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
// Добавляем импорт PublicKey для работы с адресами аккаунтов
import { PublicKey } from '@solana/web3.js'
import { initSdk, txVersion } from './config'

async function main() {
  // Инициализируем Raydium SDK с загрузкой информации о токенах
  const raydium = await initSdk({ loadToken: true })

  // Получаем информацию о токенах по их адресам
  const mintA = await raydium.token.getTokenInfo(
    '9aGQqWqHSeyVtQXNkPuTUZ3aW288fjeRLQcMmjniivEf'
  )
  const mintB = await raydium.token.getTokenInfo(
    'So11111111111111111111111111111111111111112'
  )

  // Получаем рабочие конфигурации feeConfig через API SDK
  const feeConfigs = await raydium.api.getCpmmConfigs()

  // Определяем существующий аккаунт Amm Config по его публичному ключу
  const existingAmmConfig = new PublicKey('G95xxie3XbkCqtE39GgQ9Ggc7xBC8Uceve7HFDEFApkc')

  // Модифицируем feeConfig, чтобы использовать существующий Amm Config
  const feeConfigToUse = {
    ...feeConfigs[0],
    id: existingAmmConfig.toBase58(), // задаем нужный id для Amm Config
    ammConfig: existingAmmConfig,    // переопределяем адрес Amm Config
  }

  // Создаем пул с стартовыми значениями (mintAAmount, mintBAmount можно изменить)
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: CREATE_CPMM_POOL_PROGRAM, // ID программы создания пула
    poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC, // Аккаунт платы за создание пула
    mintA,
    mintB,
    mintAAmount: new BN(100), // Начальное количество токенов mintA (пример)
    mintBAmount: new BN(100), // Начальное количество токенов mintB (пример)
    startTime: new BN(0),
    feeConfig: feeConfigToUse, // Используем модифицированный feeConfig с существующим Amm Config
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion,
  })

  // Выполняем транзакцию с подтверждением
  const { txId } = await execute({ sendAndConfirm: true })
  console.log('Пул успешно создан', {
    txId,
    poolKeys: Object.keys(extInfo.address).reduce((acc, cur) => ({
      ...acc,
      [cur]: extInfo.address[cur as keyof typeof extInfo.address].toString(),
    }), {})
  })

  process.exit(0)
}

main().catch((error) => {
  console.error('Ошибка при создании пула:', error)
  process.exit(1)
}) 
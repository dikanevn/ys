import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { initSdk, txVersion, owner } from './config';
import { getCpmmPdaPoolId, CREATE_CPMM_POOL_PROGRAM } from '@raydium-io/raydium-sdk-v2';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import fs from 'fs';
import { exec } from 'child_process';
import { CurveCalculator } from '@raydium-io/raydium-sdk-v2';

// Функция sleep для ожидания
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Функция для поиска всех пулов для пары токенов
async function findAllPools(tokenAMint: string, tokenBMint: string, raydium: any) {
  const pools = [];
  
  // Список всех возможных конфигураций AMM
  const ammConfigs = [
    '2GveMrZhNvMHwqj12PBVJJk6pQi4vj1YjJpGJxJ8KDGe', // Stable
    '2FLmGwkXaLqP1BKhAAKiP4VVz5kfuV5ZUGXQUMvqMeaX', // Stable V2
    '2GveMrZhNvMHwqj12PBVJJk6pQi4vj1YjJpGJxJ8KDGe', // Standard V3
    '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c', // Standard V4
    '2XZRJmxBCWS3Xqu1R6QkgaXcnxA6HnuJ6qy9tY6k4pJq', // Standard V5
    '2fGXL8uhqxJ4tpgtosHZXT4zcQap6j62z3bMDxdkMvy5', // Standard V6
    'G95xxie3XbkCqtE39GgQ9Ggc7xBC8Uceve7HFDEFApkc', // Из ys14.ts
  ];

  // Альтернативный способ - использовать API Raydium для получения информации о пулах
  try {
    // Проверяем каждую конфигурацию
    for (const configAddress of ammConfigs) {
      try {
        const ammConfig = new PublicKey(configAddress);
        const pubA = new PublicKey(tokenAMint);
        const pubB = new PublicKey(tokenBMint);

        // Пробуем оба варианта сортировки токенов
        const combinations = [
          { token0: pubA, token1: pubB },
          { token0: pubB, token1: pubA }
        ];

        for (const { token0, token1 } of combinations) {
          try {
            const { publicKey: poolId } = getCpmmPdaPoolId(
              CREATE_CPMM_POOL_PROGRAM,
              ammConfig,
              token0,
              token1
            );

            // Пробуем получить данные пула
            const poolData = await raydium.cpmm.getPoolInfoFromRpc(poolId.toBase58());
            
            if (poolData) {
              pools.push({
                poolId: poolId.toBase58(),
                configType: configAddress,
                data: poolData,
                baseReserve: poolData.rpcData.baseReserve.toString(),
                quoteReserve: poolData.rpcData.quoteReserve.toString(),
                tradeFeeRate: poolData.rpcData.configInfo.tradeFeeRate.toString()
              });

              console.log(`Найден пул:`, {
                id: poolId.toBase58(),
                ammConfig: configAddress,
                baseReserve: poolData.rpcData.baseReserve.toString(),
                quoteReserve: poolData.rpcData.quoteReserve.toString(),
                tradeFeeRate: poolData.rpcData.configInfo.tradeFeeRate.toString()
              });
            }
          } catch (e) {
            // Пул не найден для этой комбинации - пропускаем
            continue;
          }
        }
      } catch (error) {
        console.log(`Пропуск конфигурации ${configAddress}:`, error);
        continue;
      }
    }
  } catch (error) {
    console.error("Ошибка при поиске пулов:", error);
  }

  return pools;
}

async function main() {
  const raydium = await initSdk({ loadToken: true });
  console.log("Публичный ключ кошелька:", owner.publicKey.toBase58());
  
  let tokenAccounts;
  const startTime = Date.now();

  // Получаем токен аккаунты
  while (true) {
    if (Date.now() - startTime >= 3600 * 1000) {
      console.error("Истекло время ожидания (1 час). Завершаем выполнение.");
      process.exit(0);
    }
    
    try {
      tokenAccounts = await raydium.connection.getParsedTokenAccountsByOwner(
        owner.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );
    } catch (error: any) {
      if (error?.message?.includes("429")) {
        console.log("Слишком много запросов. Ожидание...");
        await sleep(2000);
        continue;
      }
      throw error;
    }

    const nonNativeTokenAccounts = tokenAccounts.value.filter(accountInfo => 
      accountInfo.account.data.parsed.info.mint !== NATIVE_MINT.toBase58()
    );

    if (nonNativeTokenAccounts.length === 1) {
      console.log("Найден токен (кроме SOL):", nonNativeTokenAccounts.length);
      break;
    }
    
    await sleep(1000);
  }

  const tokenAMint = tokenAccounts.value[0].account.data.parsed.info.mint;
  const tokenBMint = NATIVE_MINT.toBase58();

  console.log("Поиск всех пулов для пары токенов...");
  const pools = await findAllPools(tokenAMint, tokenBMint, raydium);

  // Сохраняем информацию о пулах
  const poolsInfo = pools.map(pool => ({
    poolId: pool.poolId,
    configType: pool.configType,
    baseReserve: pool.baseReserve,
    quoteReserve: pool.quoteReserve,
    tradeFeeRate: pool.tradeFeeRate
  }));

  fs.writeFileSync('pools.txt', JSON.stringify(poolsInfo, null, 2));
  console.log(`Найдено пулов: ${pools.length}`);

  // Если нашли пулы, пробуем выполнить свап
  if (pools.length > 0) {
    // Берем пул с наибольшей ликвидностью
    const sortedPools = pools.sort((a, b) => 
      new BN(b.baseReserve).cmp(new BN(a.baseReserve))
    );
    const bestPool = sortedPools[0];
    console.log('Используем пул с наибольшей ликвидностью:', bestPool.poolId);

    try {
      const mintAInfo = await raydium.token.getTokenInfo(tokenAMint);
      const tokenAAccount = await getAssociatedTokenAddress(
        new PublicKey(mintAInfo.address),
        owner.publicKey
      );
      
      // Проверяем существование аккаунта
      const tokenAccountInfo = await raydium.connection.getAccountInfo(tokenAAccount);
      if (!tokenAccountInfo) {
        console.error("Не найден associated token account для токена A");
        process.exit(1);
      }
      
      // Ждем появления средств
      const swapBalanceStartTime = Date.now();
      let tokenABalanceRaw: BN;
      while (true) {
        const balanceInfo = await raydium.connection.getTokenAccountBalance(tokenAAccount);
        tokenABalanceRaw = new BN(balanceInfo.value.amount);
        if (!tokenABalanceRaw.isZero()) {
          break;
        }
        if (Date.now() - swapBalanceStartTime >= 3600 * 1000) {
          console.error("Истекло время ожидания пополнения средств (1 час)");
          process.exit(0);
        }
        console.log("Недостаточно средств для свопа. Повтор через 1 секунду...");
        await sleep(1000);
      }

      const SELL_PERCENTAGE = 1;
      const sellAmount = tokenABalanceRaw.mul(new BN(SELL_PERCENTAGE)).div(new BN(100));
      console.log(`Количество токенов для свопа (${SELL_PERCENTAGE}%):`, sellAmount.toString());

      // Получаем информацию о токене B (WSOL)
      const mintBInfo = await raydium.token.getTokenInfo(
        'So11111111111111111111111111111111111111112'
      );

      // Вычисляем PDA пула, сортируя адреса токенов согласно правилам
      const pubA = new PublicKey(mintAInfo.address);
      const pubB = new PublicKey(mintBInfo.address);
      let sortedToken0: PublicKey, sortedToken1: PublicKey;
      if (Buffer.compare(pubA.toBuffer(), pubB.toBuffer()) < 0) {
        sortedToken0 = pubA;
        sortedToken1 = pubB;
      } else {
        sortedToken0 = pubB;
        sortedToken1 = pubA;
      }

      // Определяем направление свопа для сортированной пары
      const baseIn = sortedToken0.equals(new PublicKey(mintAInfo.address));

      // Вычисляем swapResult с помощью CurveCalculator.swap()
      const swapResult = CurveCalculator.swap(
        sellAmount,
        baseIn
          ? bestPool.data.rpcData.baseReserve
          : bestPool.data.rpcData.quoteReserve,
        baseIn
          ? bestPool.data.rpcData.quoteReserve
          : bestPool.data.rpcData.baseReserve,
        bestPool.data.rpcData.configInfo.tradeFeeRate
      );

      // Формирование параметров свапа с добавлением txTipConfig для Jito
      const swapParams = {
        poolInfo: bestPool.data.poolInfo,
        poolKeys: bestPool.data.poolKeys,
        inputAmount: sellAmount,
        slippage: 0.50, // % допустимой просадки
        baseIn,
        ownerInfo: { useSOLBalance: true },
        txVersion,
        swapResult,
        txTipConfig: {
          address: new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
          amount: new BN(1000000),
        }
      };

      // Пробуем выполнить свап
      let attempt = 0;
      let swapSuccess = false;
      while (attempt < 10 && !swapSuccess) {
        attempt++;
        try {
          const { execute } = await raydium.cpmm.swap(swapParams);
          const { txId } = await execute({ sendAndConfirm: true });
          console.log(`Обмен выполнен успешно, txId: ${txId} (Попытка ${attempt})`);
          swapSuccess = true;
        } catch (error) {
          console.error(`Ошибка при выполнении свопа на попытке ${attempt}:`, error);
          if (attempt < 10) {
            console.log("Повтор через 1 секунду...");
            await sleep(1000);
          }
        }
      }
      if (!swapSuccess) {
        console.error("Обмен не выполнен после 10 попыток");
      }
    } catch (error) {
      console.error("Ошибка при выполнении свопа:", error);
    }
  } else {
    console.error("Не найдено подходящих пулов для свопа");
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error('Ошибка:', error);
  process.exit(1);
}); 
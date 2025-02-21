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

    console.log("Общее количество токеновых аккаунтов (включая SOL):", tokenAccounts.value.length);
    
    // Выводим информацию о каждом токене
    tokenAccounts.value.forEach((accountInfo, index) => {
      const mint = accountInfo.account.data.parsed.info.mint;
      const isNative = mint === NATIVE_MINT.toBase58();
      console.log(`Аккаунт ${index + 1}: Mint - ${mint}${isNative ? " (Нативный SOL)" : ""}`);
    });

    const nonNativeTokenAccounts = tokenAccounts.value.filter(accountInfo => 
      accountInfo.account.data.parsed.info.mint !== NATIVE_MINT.toBase58()
    );

    if (nonNativeTokenAccounts.length === 1) {
      console.log("Найден токен (кроме SOL):", nonNativeTokenAccounts.length);
      break;
    }
    
    const remainingMs = 3600 * 1000 - (Date.now() - startTime);
    const remainingSeconds = Math.floor(remainingMs / 1000);
    console.log(`Ожидание: найдено ${nonNativeTokenAccounts.length} токенов (ожидается ровно 1). Осталось ${remainingSeconds} секунд. Повтор через секунду...`);
    await sleep(1000);
  }

  const tokenAMint = tokenAccounts.value[0].account.data.parsed.info.mint;
  const tokenBMint = NATIVE_MINT.toBase58();

  // Добавляем формирование и открытие ссылки для свапа
  const swapUrl = `https://raydium.io/swap/?inputMint=${tokenAMint}&outputMint=sol`;

  // Сохраняем найденный адрес токена и ссылку для свапа в файл token.txt
  fs.writeFileSync('token.txt', `${tokenAMint}\n${swapUrl}`);
  console.log("Сохранён адрес токена и ссылка для свапа в token.txt");

  // Открываем сформированную ссылку в браузере
  const platform = process.platform;
  let openCommand = "";
  if (platform === "win32") {
    openCommand = `start ${swapUrl}`;
  } else if (platform === "darwin") {
    openCommand = `open ${swapUrl}`;
  } else {
    openCommand = `xdg-open ${swapUrl}`;
  }
  console.log("Открываю ссылку для свапа:", swapUrl);
  exec(openCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Ошибка при открытии ссылки: ${error.message}`);
      return;
    }
    console.log("Ссылка успешно открыта в браузере.");
  });

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
      
      // Ждем появления средств и достаточной ликвидности
      const swapBalanceStartTime = Date.now();
      let tokenABalanceRaw: BN;
      let poolData: any;
      
      while (true) {
        // Проверяем баланс токена
        const balanceInfo = await raydium.connection.getTokenAccountBalance(tokenAAccount);
        tokenABalanceRaw = new BN(balanceInfo.value.amount);

        // Проверяем актуальную ликвидность пула
        try {
          poolData = await raydium.cpmm.getPoolInfoFromRpc(bestPool.poolId);
          const currentBaseReserve = new BN(poolData.rpcData.baseReserve);
          const currentQuoteReserve = new BN(poolData.rpcData.quoteReserve);
          
          console.log("Текущая ликвидность пула:", {
            baseReserve: currentBaseReserve.toString(),
            quoteReserve: currentQuoteReserve.toString()
          });

          // Проверяем что есть и баланс и достаточная ликвидность
          // Ликвидность должна быть минимум в 3 раза больше суммы свапа
          const SELL_PERCENTAGE = 75;
          const potentialSellAmount = tokenABalanceRaw.mul(new BN(SELL_PERCENTAGE)).div(new BN(100));
          
          if (!tokenABalanceRaw.isZero() && 
              currentBaseReserve.gt(potentialSellAmount.muln(3)) && 
              currentQuoteReserve.gt(potentialSellAmount.muln(3))) {
            console.log("Найдена достаточная ликвидность в пуле");
            bestPool.data = poolData; // Обновляем данные пула
            break;
          }
        } catch (e) {
          console.log("Ошибка при проверке ликвидности пула:", e);
        }

        if (Date.now() - swapBalanceStartTime >= 3600 * 1000) {
          console.error("Истекло время ожидания пополнения средств или ликвидности (1 час)");
          process.exit(0);
        }
        console.log("Ожидание средств или достаточной ликвидности. Повтор через 1 секунду...");
        await sleep(1000);
      }





















      const SELL_PERCENTAGE = 75;
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
	  
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
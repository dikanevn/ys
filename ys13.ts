import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { initSdk, txVersion, owner } from './config';
// Импортируем функцию для вычисления PDA пула.
// Функция getCpmmPdaPoolId принимает следующие параметры:
// программный ID пула, адрес Amm Config, mintA и mintB.
import { getCpmmPdaPoolId, CREATE_CPMM_POOL_PROGRAM, CurveCalculator } from '@raydium-io/raydium-sdk-v2';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import fs from 'fs';
import { exec } from 'child_process';

// Функция sleep для ожидания указанного времени (в мс)
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Инициализируем Raydium SDK с загрузкой информации о токенах
  const raydium = await initSdk({ loadToken: true });

  // Определяем публичный ключ кошелька и начинаем проверку токеновых аккаунтов в цикле
  console.log("Публичный ключ кошелька:", owner.publicKey.toBase58());
  let tokenAccounts, nonNativeTokenAccounts;

  // Добавляем счётчик времени: если поиск токенов длится более 1 часа, скрипт завершится.
  const startTime = Date.now();

  while (true) {
    // Проверяем, истек ли 1 час ожидания.
    if (Date.now() - startTime >= 3600 * 1000) {
      console.error("Истекло время ожидания (1 час). Завершаем выполнение.");
      process.exit(0);
    }
    try {
      tokenAccounts = await raydium.connection.getParsedTokenAccountsByOwner(owner.publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });
    } catch (error: any) {
      if (error && error.message && error.message.includes("429")) {
        console.log("Server responded with 429 Too Many Requests. Retrying after longer delay...");
        await sleep(2000);
        continue;
      } else {
        throw error;
      }
    }

    console.log("Общее количество токеновых аккаунтов (включая SOL):", tokenAccounts.value.length);
    tokenAccounts.value.forEach((accountInfo, index) => {
      const mint = accountInfo.account.data.parsed.info.mint;
      const isNative = mint === NATIVE_MINT.toBase58();
      console.log(`Аккаунт ${index + 1}: Mint - ${mint}${isNative ? " (Нативный SOL)" : ""}`);
    });
    nonNativeTokenAccounts = tokenAccounts.value.filter(accountInfo => {
      const mint = accountInfo.account.data.parsed.info.mint;
      return mint !== NATIVE_MINT.toBase58();
    });

    if (nonNativeTokenAccounts.length === 1) {
      console.log("Найдено токенов (кроме SOL):", nonNativeTokenAccounts.length);
      break;
    } else {
      const remainingMs = 3600 * 1000 - (Date.now() - startTime);
      const remainingSeconds = Math.floor(remainingMs / 1000);
      console.log(`Ожидание: найдено ${nonNativeTokenAccounts.length} токенов (ожидается ровно 1). Осталось ${remainingSeconds} секунд. Повтор через ...`);
      await sleep(1000);
    }
  }

  // Продолжаем работу со скриптом после успешного обнаружения ровно одного ненативного токена
  const tokenAMint = nonNativeTokenAccounts[0].account.data.parsed.info.mint;
  // Формируем ссылку для свапа, подставляя найденный токен в параметр inputMint
  const swapUrl = `https://raydium.io/swap/?inputMint=${tokenAMint}&outputMint=sol`;

  // Сохраняем найденный адрес токена и ссылку для свапа в файл token.txt
  fs.writeFileSync('token.txt', `${tokenAMint}\n${swapUrl}`);
  console.log("Сохранён адрес токена и ссылка для свапа в token.txt");

  // Открываем сформированную ссылку в браузере.
  // Определяем команду для открытия в зависимости от платформы:
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

  const mintAInfo = await raydium.token.getTokenInfo(tokenAMint);

  // Получаем информацию о токене B (WSOL)
  const mintBInfo = await raydium.token.getTokenInfo(
    'So11111111111111111111111111111111111111112'
  );

  // Указываем адрес Amm Config, который используется в ys7.ts
  const ammConfigAddress = new PublicKey('G95xxie3XbkCqtE39GgQ9Ggc7xBC8Uceve7HFDEFApkc');

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
  const { publicKey: poolIdSorted } = getCpmmPdaPoolId(
    CREATE_CPMM_POOL_PROGRAM,
    ammConfigAddress,
    sortedToken0,
    sortedToken1
  );
  console.log('Computed CPmm Pool PDA (Sorted):', poolIdSorted.toBase58());

  // Получение информации о пуле через RPC (только для сортированного варианта)
  let sortedPoolData: any = null;
  const poolSearchStartTime = Date.now();
  while (true) {
    if (Date.now() - poolSearchStartTime >= 10 * 60 * 1000) {
      console.error("Истекло время поиска пары (10 минут). Завершаем выполнение.");
      process.exit(0);
    }
    try {
      sortedPoolData = await raydium.cpmm.getPoolInfoFromRpc(poolIdSorted.toBase58());
      if (sortedPoolData) {
        console.log('Пул (Sorted) получен');
        break;
      }
    } catch (error) {
      console.log("Ошибка получения информации о пуле. Повтор через 1 секунду...");
    }
    await sleep(1000);
  }

  // Если данные отсортированного пула получены, проверяем баланс токена A и выполняем свап 100% от баланса
  if (sortedPoolData) {
    try {
      // Получаем ассоциированный токен-аккаунт для токена A.
      const tokenAAccount = await getAssociatedTokenAddress(
        new PublicKey(mintAInfo.address),
        owner.publicKey
      );
      
      // Проверяем, существует ли аккаунт для токена A.
      const tokenAccountInfo = await raydium.connection.getAccountInfo(tokenAAccount);
      if (!tokenAccountInfo) {
        console.error("Не найден associated token account для токена A. Пожалуйста, создайте его.");
        process.exit(1);
      }
      
      // Проверяем баланс токена A до появления средств, пробуем в течение 1 часа.
      const swapBalanceStartTime = Date.now();
      let tokenABalanceRaw: BN;
      while (true) {
        const balanceInfo = await raydium.connection.getTokenAccountBalance(tokenAAccount);
        tokenABalanceRaw = new BN(balanceInfo.value.amount);
        if (!tokenABalanceRaw.isZero()) {
          break;
        }
        if (Date.now() - swapBalanceStartTime >= 3600 * 1000) {
          console.error("Истекло время ожидания пополнения средств (1 час). Завершаем выполнение.");
          process.exit(0);
        }
        console.log("Недостаточно средств для свопа. Повтор проверки баланса через 1 секунду...");
        await sleep(1000);
      }
      const sellAmount = tokenABalanceRaw; // Продаём 100% от баланса
      console.log("количество токенов для свопа:", sellAmount.toString());

      // Определяем направление свопа для сортированной пары:
      // Если sortedToken0 равен адресу токена A, значит baseIn = true, иначе false.
      const baseIn = sortedToken0.equals(new PublicKey(mintAInfo.address));

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
      );

      const swapParams = {
        poolInfo: sortedPoolData.poolInfo,
        poolKeys: sortedPoolData.poolKeys,
        inputAmount: sellAmount,
        slippage: 0.20, 
        baseIn,
        ownerInfo: { useSOLBalance: true },
        txVersion,
        swapResult, // добавляем вычисленный swapResult
      };
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
      console.error("Ошибка при выполнении свопа", error);
    }
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error('Ошибка:', error);
  process.exit(1);
}); 
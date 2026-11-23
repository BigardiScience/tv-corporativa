import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { userInfo } from 'node:os';
import { createApp } from '../server/core.mjs';
import { createLogger } from '../server/lib/logger.mjs';

let app, rl, muted=false;
const controller=new AbortController();
const terminalOutput=new Writable({write(chunk,encoding,done){if(!muted)stdout.write(chunk,encoding);done();}});
try {
  if(!stdin.isTTY||!stdout.isTTY)throw new Error('Execute npm run reset-admin em um terminal interativo local no servidor da aplicação.');
  app=createApp({ logger: createLogger({ level: 'warn', sink: line => process.stderr.write(`${line}\n`) }) });
  if(!app.configured())throw new Error('Nenhuma conta foi configurada. Use npm run configure para o primeiro acesso.');
  rl=createInterface({input:stdin,output:terminalOutput,terminal:true});
  rl.on('SIGINT',()=>controller.abort());
  const ask=prompt=>rl.question(prompt,{signal:controller.signal});
  const hidden=async prompt=>{
    stdout.write(prompt);muted=true;
    try{return await ask('');}
    finally{muted=false;stdout.write('\n');}
  };
  console.log('Recuperação administrativa local. Exige acesso ao servidor e a uma conta administrativa ativa.');
  console.log('Todas as sessões da conta serão encerradas. A operação será registrada na auditoria.');
  const email=await ask('E-mail da conta administrativa: ');
  const password=await hidden('Nova senha (mínimo 12 caracteres): '),confirm=await hidden('Confirme a nova senha: ');
  if(password!==confirm)throw new Error('As senhas não coincidem.');
  app.resetAdminPassword(email,password,userInfo().username);
  console.log('Senha redefinida e sessões encerradas. Entre novamente com a nova senha.');
} catch(error){console.error(error.name==='AbortError'?'Recuperação cancelada.':error.message);process.exitCode=1;}
finally{muted=false;rl?.close();stdin.pause();stdin.unref?.();terminalOutput.end();await app?.close();}

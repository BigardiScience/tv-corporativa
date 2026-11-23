import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { createApp } from '../server/core.mjs';
import { createLogger } from '../server/lib/logger.mjs';

let app, rl, muted=false;
const controller=new AbortController();
const terminalOutput=new Writable({write(chunk,encoding,done){if(!muted)stdout.write(chunk,encoding);done();}});
try {
  if(!stdin.isTTY||!stdout.isTTY)throw new Error('Execute npm run configure em um terminal interativo local, como o terminal integrado do VS Code.');
  app=createApp({ logger: createLogger({ level: 'warn', sink: line => process.stderr.write(`${line}\n`) }) });
  if(app.configured())throw new Error('Um administrador já existe. Use o painel de usuários ou npm run reset-admin para recuperação local.');
  rl=createInterface({input:stdin,output:terminalOutput,terminal:true});
  rl.on('SIGINT',()=>controller.abort());
  const ask=prompt=>rl.question(prompt,{signal:controller.signal});
  const hidden=async prompt=>{
    stdout.write(prompt);muted=true;
    try{return await ask('');}
    finally{muted=false;stdout.write('\n');}
  };
  console.log('Configuração inicial local. A senha será ocultada e não será impressa.');
  const name=await ask('Seu nome: '),email=await ask('E-mail corporativo: ');
  const password=await hidden('Senha (mínimo 12 caracteres): '),confirm=await hidden('Confirme a senha: ');
  if(password!==confirm)throw new Error('As senhas não coincidem.');
  app.createAdmin(name,email,password);
  console.log('Administrador criado. Execute npm start e entre com sua conta.');
} catch(error){console.error(error.name==='AbortError'?'Configuração cancelada.':error.message);process.exitCode=1;}
finally{muted=false;rl?.close();stdin.pause();stdin.unref?.();terminalOutput.end();await app?.close();}

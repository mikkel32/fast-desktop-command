import {mkdir,cp,readdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
for(const file of await readdir('worker'))if(file.endsWith('.js'))await cp('worker/'+file,'dist/server/'+file);
await cp('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built Worker, branding, tool schemas, and migrations.');

import {createServer} from 'node:http';
import worker from '../worker/server.js';
const server=createServer(async(req,res)=>{
 try{
  let body='';for await(const chunk of req)body+=chunk;
  const request=new Request('http://127.0.0.1:'+server.address().port+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})});
  const response=await worker.fetch(request,{}, {waitUntil:()=>{}});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(0,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:'+server.address().port));

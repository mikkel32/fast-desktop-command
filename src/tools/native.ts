import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {CONFIG_FILE} from '../config.js';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import type {ServerResult} from '../types.js';

const schemas = {
    native_permissions: z.object({}),
    native_apps: z.object({}),
    native_windows: z.object({pid:z.number().int().positive().optional()}),
    native_screenshot: z.object({windowId:z.number().int().nonnegative()}),
    native_click: z.object({x:z.number().finite(),y:z.number().finite(),button:z.enum(['left','right']).default('left')}),
    native_type: z.object({text:z.string().max(4000)}),
    native_key: z.object({key:z.enum(['return','tab','space','escape','backspace','delete','left','right','down','up','a','c','v','x','z','q','w','s','f','l']),modifiers:z.array(z.enum(['command','shift','option','control'])).default([])}),
};
const descriptions: Record<keyof typeof schemas,string> = {
    native_permissions:'Read the macOS Accessibility and Screen Recording permission status without prompting or changing it.',
    native_apps:'List running native applications with their bundle IDs, PIDs, and active state.',
    native_windows:'List visible windows and screen bounds. Window titles may be hidden until Screen Recording is allowed.',
    native_screenshot:'Capture an exact visible window selected from native_windows. Requires macOS Screen Recording permission.',
    native_click:'Click a screen coordinate from a fresh window screenshot. Requires enabled native controls and macOS Accessibility. Verify the result after clicking.',
    native_type:'Type text into the currently focused application. Inspect focus first. Requires enabled native controls and macOS Accessibility.',
    native_key:'Press a supported key and optional modifiers in the focused app. Requires enabled native controls and macOS Accessibility. Verify the resulting state.',
};
export const nativeTools = Object.entries(schemas).map(([name,schema])=>({
    name,description:descriptions[name as keyof typeof schemas],inputSchema:zodToJsonSchema(schema),
    annotations:{readOnlyHint:!['native_click','native_type','native_key'].includes(name),destructiveHint:['native_click','native_type','native_key'].includes(name),openWorldHint:false},
}));
let lastSnapshot: {windowId:number;pid:number;bounds:Record<string,number>;capturedAt:number}|undefined;
async function nativeInputEnabled(): Promise<boolean> {
    // Do not wait for another process's debounced configuration watcher when
    // the user has just disabled input in the app.
    try {return JSON.parse(await readFile(CONFIG_FILE,'utf8')).nativeControlEnabled===true;} catch {return false;}
}
export async function nativeTool(name: string, args: unknown): Promise<ServerResult> {
    if(!(name in schemas))return {content:[{type:'text',text:'Unknown native tool.'}],isError:true};
    const parsed=schemas[name as keyof typeof schemas].safeParse(args);
    if(!parsed.success)return {content:[{type:'text',text:parsed.error.message}],isError:true};
    if(['native_click','native_type','native_key'].includes(name) && !await nativeInputEnabled())
        return {content:[{type:'text',text:'Native input is disabled. Enable Native controls in the Fast Desktop Command app. Do not bypass this preference.'}],isError:true};
    if(process.platform!=='darwin')return {content:[{type:'text',text:'Native computer tools require macOS.'}],isError:true};
    const input=['native_click','native_type','native_key'].includes(name);
    if(input && (!lastSnapshot || Date.now()-lastSnapshot.capturedAt>120000))
        return {content:[{type:'text',text:'Capture the target window with native_screenshot in this session before sending native input.'}],isError:true};
    const executable=process.env.FAF_NATIVE_HELPER || fileURLToPath(new URL('../../macos/.build/release/NativeControl',import.meta.url));
    try {
        const result=await new Promise<any>((resolve,reject)=>{
            const child=execFile(executable,['--native'],{timeout:20000,maxBuffer:24*1024*1024},(error,stdout)=>{
                try{const value=JSON.parse(stdout);if(value.error)reject(new Error(value.error));else if(error)reject(error);else resolve(value);}catch(parseError){reject(error||parseError);}
            });
            child.stdin?.end(JSON.stringify({operation:name.replace('native_',''),arguments:{...parsed.data,...(input?{target:lastSnapshot}:{})}}));
        });
        if(result.image){const {image,...metadata}=result;lastSnapshot={windowId:result.windowId,pid:result.pid,bounds:result.bounds,capturedAt:Date.now()};return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',data:image,mimeType:result.mimeType}]};}
        return {content:[{type:'text',text:JSON.stringify(result)}]};
    }catch(error){return {content:[{type:'text',text:error instanceof Error?error.message:String(error)}],isError:true};}
}

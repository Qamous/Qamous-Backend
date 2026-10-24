// Offline publication preparation. A separately admitted, current D1 export is
// the only input; this command never queries production or resumes writers.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {packagePublicSnapshot,validateExportMetadata} from './package-public-snapshot.mjs';

export async function preparePublicRelease({dictionaryFile,exportMetadataFile,workDirectory,outputDirectory}) {
  const source=resolve(dictionaryFile),metadata=resolve(exportMetadataFile),work=resolve(workDirectory),output=resolve(outputDirectory);
  validateExportMetadata(JSON.parse(await readFile(metadata,'utf8')),await readFile(source));
  for(const path of [work,output])if(await access(path).then(()=>true,()=>false))throw Error('Preparation requires new work and output directories');
  if(work===output||output.startsWith(work+sep)||work.startsWith(output+sep))throw Error('Work and public output must be separate directories');
  await mkdir(work,{recursive:true});
  const emptySupport=join(work,'empty-support.sql'),projection=join(work,'projection-private');
  await writeFile(emptySupport,'-- Consolidated export already includes support tables.\n');
  const builder=fileURLToPath(new URL('./build-public-cache-snapshot.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[builder,source,emptySupport,projection],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  await writeFile(join(work,'projection-diagnostics-private.log'),(result.stdout||'')+'\n'+(result.stderr||''));
  if(result.status!==0)throw Error('Offline projection failed; private diagnostics retained in the work directory');
  const report=await packagePublicSnapshot({dictionaryFile:source,projectionDirectory:projection,exportMetadataFile:metadata,outputDirectory:output});
  await writeFile(join(work,'public-validation-private.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={},names={'--dictionary':'dictionaryFile','--metadata':'exportMetadataFile','--work':'workDirectory','--output':'outputDirectory'};
  for(let i=2;i<process.argv.length;i+=2){const key=names[process.argv[i]];if(!key||!process.argv[i+1]||options[key])throw Error('Use --dictionary <private.sql> --metadata <private.json> --work <new private directory> --output <new public directory>');options[key]=process.argv[i+1];}
  if(Object.keys(options).length!==4)throw Error('All four preparation paths are required');
  console.log(JSON.stringify(await preparePublicRelease(options)));
}

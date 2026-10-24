import {validateImportPause} from './free-plan-guard.mjs';

export function validateLiveImportState(settings,schedules) {
  const flag=settings?.bindings?.find(binding=>binding.name==='PUBLIC_READ_ONLY')?.text;
  const current={vars:{PUBLIC_READ_ONLY:flag},triggers:{crons:flag==='true'?[]:['* * * * *']}};
  return validateImportPause(current,schedules?.schedules);
}

export function validateImportApiReady(settings) {
  if(settings?.bindings?.find(binding=>binding.name==='PUBLIC_READ_ONLY')?.text!=='false')
    throw Error('Deployment refused: qamous-api must be explicitly unpaused before ingestion resumes');
}

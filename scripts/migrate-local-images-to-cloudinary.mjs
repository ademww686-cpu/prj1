import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pool,q} from '../server/src/db.js';
import {v2 as cloudinary} from 'cloudinary';

const apply=process.argv.includes('--apply');
const credentials=['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'];
if(apply&&credentials.some(name=>!process.env[name]))throw new Error(`--apply requires ${credentials.join(', ')} in the environment.`);
if(apply)cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
const here=path.dirname(fileURLToPath(import.meta.url));
const uploadDir=path.resolve(here,'../storage/uploads');
const folder=(process.env.CLOUDINARY_FOLDER||'model-farm/site-images').replace(/^\/+|\/+$/g,'');
try{
  const rows=await q("SELECT slot_key,storage_name,mime_type,width,height,size_bytes FROM site_images WHERE storage_provider='local' ORDER BY slot_key");
  for(const row of rows.rows){
    const filename=path.basename(row.storage_name);
    if(filename!==row.storage_name)throw new Error(`Unsafe local storage name for slot ${row.slot_key}.`);
    const file=path.join(uploadDir,filename);
    if(!apply){console.log(`DRY RUN: would upload ${row.slot_key} from ${file}`);continue;}
    await fs.access(file);
    const publicId=`legacy-${row.slot_key}-${Date.now()}`;
    const uploaded=await cloudinary.uploader.upload(file,{folder,public_id:publicId,resource_type:'image',overwrite:false,unique_filename:false,use_filename:false});
    const storageName=`${folder}/${publicId}`;
    const updated=await q("UPDATE site_images SET storage_name=$1,storage_provider='cloudinary',storage_url=$2,updated_at=NOW() WHERE slot_key=$3 AND storage_provider='local' RETURNING slot_key",[storageName,uploaded.secure_url,row.slot_key]);
    if(!updated.rowCount)throw new Error(`Cloudinary upload completed but database row changed for ${row.slot_key}; uploaded asset: ${uploaded.public_id}`);
    console.log(`Migrated ${row.slot_key} to ${uploaded.public_id}`);
  }
}finally{await pool.end();}

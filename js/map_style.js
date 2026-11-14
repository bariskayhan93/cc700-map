// Device channel precision; candidate colors never change the installed firmware.
export function rgb565(hex) {
 if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
 const c=parseInt(hex.slice(1),16),r=(c>>>19)&31,g=(c>>>10)&63,b=(c>>>3)&31;
 return '#'+[(r<<3)|(r>>2),(g<<2)|(g>>4),(b<<3)|(b>>2)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const CYCLING={'#2f7fcf':'#378b98','#72b8f2':'#82cbd5','#5a3b20':'#66615a'};
export function mapColor(hex,profile='v18') {
 return rgb565(profile==='cycling' ? CYCLING[hex] || hex : hex);
}

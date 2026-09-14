const fs = require('fs');

// Endpoints base
const CATALOG_BASE_URL = 'https://kissasia.id/api/frontend/drama?limit=50';
const CONTENT_BASE_URL = 'https://kissasia.id/api/frontend/content';
const DELAY_MS = 5000;

async function runCrawler() {
    try {
        console.log('--- Iniciando Crawler Inteligente ---');
        
        let localItems = [];
        let isInitialDownload = true;

        if (fs.existsSync('catalogo.json')) {
            try {
                const rawData = fs.readFileSync('catalogo.json', 'utf8');
                const parsed = JSON.parse(rawData);
                localItems = parsed.items || parsed || [];
                if (localItems.length > 0) {
                    isInitialDownload = false;
                    console.log(`Catálogo local detectado (${localItems.length} títulos). Modo INCREMENTAL.`);
                }
            } catch (e) {
                console.log('catalogo.json corrupto. Descarga COMPLETA.');
            }
        }

        let titlesToProcess = [];
        const existingIds = new Set(localItems.map(item => String(item.id)));

        if (isInitialDownload) {
            console.log("Obteniendo catálogo completo...");
            const firstResponse = await fetch(`${CATALOG_BASE_URL}&offset=0`);
            if (!firstResponse.ok) throw new Error('Error de conexión en offset=0');
            const firstData = await firstResponse.json();
            
            let allCatalogItems = [...(firstData.items || [])];
            const totalItems = firstData.total || 0;
            const limit = firstData.limit || 50;
            const totalPages = Math.ceil(totalItems / limit);

            console.log(`Total de elementos: ${totalItems} (~${totalPages} páginas)`);

            const promises = [];
            for (let page = 1; page < totalPages; page++) {
                const currentOffset = page * limit;
                promises.push(
                    fetch(`${CATALOG_BASE_URL}&offset=${currentOffset}`)
                        .then(res => res.json())
                        .then(data => data.items || [])
                        .catch(e => {
                            console.error(`Error en offset ${currentOffset}:`, e);
                            return [];
                        })
                );
            }

            const remainingResults = await Promise.all(promises);
            remainingResults.forEach(items => {
                allCatalogItems = allCatalogItems.concat(items);
            });

            titlesToProcess = allCatalogItems;
            console.log(`Títulos obtenidos del catálogo: ${titlesToProcess.length}`);
        } else {
            // MODO INCREMENTAL (Revisa los últimos 50 títulos usando offset=0)
            console.log('Revisando los últimos 50 títulos para buscar novedades semanales...');
            const response = await fetch(`${CATALOG_API_URL}&offset=0`); // <--- Cambiar &page=1 por &offset=0

            if (!response.ok) throw new Error(`Error en el catálogo incremental (Status: ${response.status})`);

            const catalogData = await response.json();
            const latestItems = catalogData.items || [];

            // Filtrar solo lo que NO tengamos guardado en el JSON local
            titlesToProcess = latestItems.filter(item => !existingIds.has(String(item.id)));
        }

        if (titlesToProcess.length === 0) {
            console.log('Catálogo al día. Sin novedades.');
            return;
        }

        console.log(`Procesando ${titlesToProcess.length} títulos...`);

        for (let i = 0; i < titlesToProcess.length; i++) {
            const item = titlesToProcess[i];
            const slug = item.slug;

            console.log(`[${i + 1}/${titlesToProcess.length}] Procesando contenido: ${slug}`);

            try {
                const detailResponse = await fetch(`${CONTENT_BASE_URL}/${slug}`);
                if (detailResponse.ok) {
                    const detailData = await detailResponse.json();
                    
                    if (detailData && detailData.status === "ok") {
                        Object.assign(item, detailData);
                        
                        // Extraer enlaces de video y subtítulos para cada episodio
                        if (Array.isArray(item.episodes) && item.episodes.length > 0) {
                            for (let ep of item.episodes) {
                                try {
                                    const epResponse = await fetch(`${CONTENT_BASE_URL}/${slug}/episodes/${ep.id}`);
                                    if (epResponse.ok) {
                                        const epData = await epResponse.json();
                                        if (epData && epData.episode) {
                                            ep.video_url = epData.episode.video_url || null;
                                            ep.tracks = epData.episode.tracks || [];
                                            ep.main_sub_url = epData.episode.main_sub_url || null;
                                        }
                                    }
                                } catch (epErr) {
                                    console.error(` Error obteniendo episodio ${ep.id}:`, epErr.message);
                                }
                            }
                            console.log(`   --> ✓ OK: ${item.episodes.length} episodios e información de video/subtítulos procesados.`);
                        }
                    } else {
                        item.episodes = [];
                    }
                } else {
                    console.error(`   --> ✗ Error HTTP en ${slug} (${detailResponse.status})`);
                    item.episodes = [];
                }
            } catch (err) {
                console.error(`   --> ✗ Error de red en ${slug}:`, err.message);
                item.episodes = [];
            }

            if (i < titlesToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        let finalCatalogList = isInitialDownload 
            ? titlesToProcess 
            : [...titlesToProcess, ...localItems];

        const finalData = {
            status: "ok",
            items: finalCatalogList,
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync('catalogo.json', JSON.stringify(finalData, null, 2), 'utf8');
        console.log(`¡Éxito! Títulos guardados: ${finalCatalogList.length}`);

    } catch (error) {
        console.error('Error crítico:', error);
        process.exit(1);
    }
}

runCrawler();

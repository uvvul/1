const fs = require('fs');

// Endpoints
const CATALOG_API_URL = 'https://kissasia.id/api/v1/catalog?limit=50';
const CONTENT_API_URL = 'https://kissasia.id/api/v1/content';
const DELAY_MS = 5000; // 5 segundos para mantener a salvo el runner de GitHub

async function runCrawler() {
    try {
        console.log('--- Iniciando Crawler Inteligente (Histórico + Incremental) ---');
        
        let localItems = [];
        let isInitialDownload = true;

        // 1. Intentar cargar el catálogo local
        if (fs.existsSync('catalogo.json')) {
            try {
                const rawData = fs.readFileSync('catalogo.json', 'utf8');
                const parsed = JSON.parse(rawData);
                localItems = parsed.items || parsed || [];
                if (localItems.length > 0) {
                    isInitialDownload = false;
                    console.log(`Catálogo local detectado. Títulos guardados: ${localItems.length}. Cambiando a modo INCREMENTAL.`);
                }
            } catch (e) {
                console.log('catalogo.json corrupto o inválido. Se procederá a una descarga COMPLETA.');
            }
        } else {
            console.log('No se encontró catalogo.json. Iniciando descarga COMPLETA de la plataforma...');
        }

        let titlesToProcess = [];
        const existingIds = new Set(localItems.map(item => item.id));

        // 2. Obtener los títulos de la API según el modo
        if (isInitialDownload) {
            // MODO COMPLETO (Tu lógica original intacta)
            console.log("Descargando todas las páginas del catálogo...");
            const firstResponse = await fetch(`${CATALOG_API_URL}&page=1`);
            if (!firstResponse.ok) throw new Error('Error al conectar con la API en la página 1');
            const firstData = await firstResponse.json();
            
            let allCatalogItems = [...firstData.items];
            const totalPages = firstData.pagination.pages;
            console.log(`Total de páginas detectadas: ${totalPages}`);

            const promises = [];
            for (let i = 2; i <= totalPages; i++) {
                promises.push(
                    fetch(`${CATALOG_API_URL}&page=${i}`)
                        .then(res => res.json())
                        .then(data => data.items)
                        .catch(e => {
                            console.error(`Error en página ${i}:`, e);
                            return [];
                        })
                );
            }

            const remainingResults = await Promise.all(promises);
            remainingResults.forEach(items => {
                allCatalogItems = allCatalogItems.concat(items);
            });

            // Todos estos títulos clonados irán a procesamiento para buscar episodios
            titlesToProcess = allCatalogItems;
            console.log(`Total de títulos descargados del catálogo: ${titlesToProcess.length}`);
        } else {
            // MODO INCREMENTAL (Solo revisa los últimos 50)
            console.log('Revisando los últimos 50 títulos para buscar novedades semanales...');
            const response = await fetch(`${CATALOG_API_URL}&page=1`);
            if (!response.ok) throw new Error(`Error en el catálogo incremental (Status: ${response.status})`);
            
            const catalogData = await response.json();
            const latestItems = catalogData.items || [];

            // Filtrar solo lo que NO tengamos guardado en el JSON local
            titlesToProcess = latestItems.filter(item => !existingIds.has(item.id));
        }

        // 3. Validar si hay trabajo que hacer
        if (titlesToProcess.length === 0) {
            console.log('----------------------------------------------------');
            console.log('El catálogo ya está completamente al día. Sin títulos nuevos.');
            return;
        }

        console.log('----------------------------------------------------');
        console.log(`Procesando ${titlesToProcess.length} títulos para extraer/actualizar episodios...`);

        // 4. Bucle para extraer los episodios desde /content/{slug}
        for (let i = 0; i < titlesToProcess.length; i++) {
            const item = titlesToProcess[i];
            const slug = item.slug;

            console.log(`[${i + 1}/${titlesToProcess.length}] Conectando a /content/${slug}`);

            try {
                const detailResponse = await fetch(`${CONTENT_API_URL}/${slug}`);
                if (detailResponse.ok) {
                    const detailData = await detailResponse.json();
                    
                    if (detailData && detailData.data) {
                        // Combinamos los datos detallados (incluyendo episodios) en el objeto original
                        Object.assign(item, detailData.data);
                        console.log(`   --> ✓ OK: ${detailData.data.episodes ? detailData.data.episodes.length : 0} episodios integrados.`);
                    } else {
                        item.episodes = [];
                        console.log(`   --> ! Advertencia: Respuesta sin estructura '.data'.`);
                    }
                } else {
                    console.error(`   --> ✗ Error HTTP en contenido para ${slug} (${detailResponse.status})`);
                    item.episodes = [];
                }
            } catch (err) {
                console.error(`   --> ✗ Error de red en ${slug}:`, err.message);
                item.episodes = [];
            }

            // Delay preventivo para no saturar la API ni alarmar a GitHub
            if (i < titlesToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        // 5. Consolidar y guardar
        let finalCatalogList;
        if (isInitialDownload) {
            finalCatalogList = titlesToProcess;
        } else {
            // Si es incremental, los nuevos van al principio custodiando el archivo histórico anterior
            finalCatalogList = [...titlesToProcess, ...localItems];
        }

        const finalData = {
            status: "ok",
            items: finalCatalogList,
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync('catalogo.json', JSON.stringify(finalData, null, 2), 'utf8');
        console.log('----------------------------------------------------');
        console.log(`¡Éxito! Base de datos guardada. Total de títulos en catálogo: ${finalCatalogList.length}`);

    } catch (error) {
        console.error('Error crítico en la ejecución del crawler:', error);
        process.exit(1);
    }
}

runCrawler();

// ==UserScript==
// @name         Affichage métriques de page (avec temps de rendu SPA)
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Affiche le domaine, chemin, paramètres et temps de rendu dans un div en bas à gauche - Support SPA complet
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('Script de métriques démarré');

    // Variables globales pour le suivi
    let lastPathAndHash = '';
    let clickTime = 0;
    let navigationStartTime = 0;
    let initialLoadTime = 0;
    let initialDOMLoadTime = 0;

    // Fonction pour créer l'élément div qui contiendra les infos
    function createMetricsDiv() {
        console.log('Création du div de métriques');
        const metricsDiv = document.createElement('div');

        // Styling du div
        Object.assign(metricsDiv.style, {
            position: 'fixed',
            bottom: '0px',
            right: '0px',
            backgroundColor: 'black',
            color: 'white',
            padding: '4px',
            fontSize: '10px',
            fontFamily: 'monospace',
            zIndex: '9999999',
            lineHeight: '1.2',
            opacity: '0.8',
            borderTopRightRadius: '3px',
            whiteSpace: 'normal',
            maxWidth: '300px',
            wordWrap: 'break-word',
            overflow: 'visible',
            pointerEvents: 'none'
        });

        metricsDiv.id = 'page-metrics-display';
        return metricsDiv;
    }

    // Fonction pour extraire correctement les informations d'URL avec support des fragments (#)
    function parseURL(url) {
        const currentURL = new URL(url);

        // Extraire le domaine
        const domainInfo = currentURL.hostname;

        // Pour le chemin, on combine le pathname et le hash (fragment)
        let pathInfo = currentURL.pathname;

        // Si nous avons un fragment (#), on le considère comme partie du chemin
        if (currentURL.hash) {
            // Si le hash contient un ?, on sépare la partie chemin des paramètres
            if (currentURL.hash.includes('?')) {
                pathInfo = pathInfo + currentURL.hash.split('?')[0];
            } else {
                pathInfo = pathInfo + currentURL.hash;
            }
        }

        // Pour les paramètres, on examine d'abord search (après ?)
        let paramsInfo = currentURL.search;

        // Vérifier aussi les paramètres après le # (cas spécial des SPA)
        if (currentURL.hash && currentURL.hash.includes('?')) {
            const hashParts = currentURL.hash.split('?');
            if (hashParts.length > 1) {
                // Si nous avons déjà des paramètres de search, ajouter ceux du hash
                if (paramsInfo) {
                    paramsInfo += '&' + hashParts[1];
                } else {
                    paramsInfo = '?' + hashParts[1];
                }
            }
        }

        // Si aucun paramètre n'est trouvé
        if (!paramsInfo) {
            paramsInfo = "(aucun paramètre)";
        }

        return {
            domainInfo,
            pathInfo,
            paramsInfo
        };
    }

    // Fonction pour calculer le temps de chargement initial de la page
    function getInitialLoadTimes() {
        if (initialLoadTime > 0 && initialDOMLoadTime > 0) {
            return { initialLoadTime, initialDOMLoadTime };
        }

        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;

            if (timing.loadEventEnd > 0 && timing.navigationStart > 0) {
                initialLoadTime = timing.loadEventEnd - timing.navigationStart;
                initialDOMLoadTime = timing.domContentLoadedEventEnd - timing.navigationStart;
            }
        }

        // Mise à jour avec l'API Performance moderne si disponible
        if (window.performance && typeof performance.getEntriesByType === 'function') {
            try {
                const navEntries = performance.getEntriesByType('navigation');
                if (navEntries.length > 0) {
                    const navEntry = navEntries[0];
                    initialLoadTime = Math.round(navEntry.loadEventEnd);
                    initialDOMLoadTime = Math.round(navEntry.domContentLoadedEventEnd);
                }
            } catch (e) {
                console.error('Erreur avec l\'API Performance moderne:', e);
            }
        }

        return { initialLoadTime, initialDOMLoadTime };
    }

    // Fonction pour détecter quand le contenu est complètement chargé après une navigation SPA
    function detectContentLoadEnd() {
        // On commence à vérifier l'activité du réseau et les mutations DOM
        let lastNetworkActivity = performance.now();
        let lastDOMMutation = performance.now();
        let contentStableTime = 0;

        // Observer les mutations DOM pour détecter quand le contenu se stabilise
        const observer = new MutationObserver(() => {
            lastDOMMutation = performance.now();
        });

        // Observer tout le corps de la page pour les changements d'éléments
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        // Intercepter les requêtes XHR
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;
        let activeXHRs = 0;

        XMLHttpRequest.prototype.open = function() {
            this.addEventListener('loadend', () => {
                activeXHRs--;
                lastNetworkActivity = performance.now();
            });
            return originalXHROpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function() {
            activeXHRs++;
            lastNetworkActivity = performance.now();
            return originalXHRSend.apply(this, arguments);
        };

        // Intercepter les requêtes fetch
        const originalFetch = window.fetch;

        window.fetch = function() {
            lastNetworkActivity = performance.now();
            const fetchPromise = originalFetch.apply(this, arguments);

            fetchPromise.then(() => {
                lastNetworkActivity = performance.now();
            }).catch(() => {
                lastNetworkActivity = performance.now();
            });

            return fetchPromise;
        };

        // Vérifier périodiquement si le contenu s'est stabilisé
        const stabilityInterval = setInterval(() => {
            const now = performance.now();
            const timeSinceLastDOMMutation = now - lastDOMMutation;
            const timeSinceLastNetworkActivity = now - lastNetworkActivity;

            // Si aucune activité pendant au moins 200ms et aucune requête XHR active
            if (timeSinceLastDOMMutation > 200 && timeSinceLastNetworkActivity > 200 && activeXHRs === 0) {
                if (contentStableTime === 0) {
                    contentStableTime = now;
                } else if (now - contentStableTime > 300) {
                    // Le contenu est stable depuis plus de 300ms, considérons que le chargement est terminé
                    clearInterval(stabilityInterval);
                    observer.disconnect();

                    // Restaurer les fonctions originales
                    XMLHttpRequest.prototype.open = originalXHROpen;
                    XMLHttpRequest.prototype.send = originalXHRSend;
                    window.fetch = originalFetch;

                    // Mettre à jour le temps de rendu SPA
                    const renderTime = Math.round(now - navigationStartTime);
                    updateRenderTime(renderTime);
                }
            } else {
                // Réinitialiser si de l'activité est détectée
                contentStableTime = 0;
            }
        }, 100);

        // Arrêter la détection après 10 secondes dans tous les cas
        setTimeout(() => {
            clearInterval(stabilityInterval);
            observer.disconnect();

            // Restaurer les fonctions originales
            XMLHttpRequest.prototype.open = originalXHROpen;
            XMLHttpRequest.prototype.send = originalXHRSend;
            window.fetch = originalFetch;

            // Si le contenu n'a pas été détecté comme stable, utilisez le temps actuel
            if (contentStableTime === 0) {
                const renderTime = Math.round(performance.now() - navigationStartTime);
                updateRenderTime(renderTime);
            }
        }, 10000);
    }

    // Fonction pour mettre à jour uniquement le temps de rendu dans le div de métriques
    function updateRenderTime(renderTime, isInitialLoad = true) {
        const metricsDiv = document.getElementById('page-metrics-display');
        if (!metricsDiv) return;

        // Extraire le contenu actuel
        const lines = metricsDiv.innerHTML.split('</div>');

        // Remplacer la dernière ligne (temps de chargement)
        if (lines.length >= 4) {
            if (isInitialLoad) {
                lines[3] = `<div>Temps: ${renderTime/1000}s `;
            } else {
                lines[3] = `<div>Temps: ${renderTime/1000}s *`;
            }
            metricsDiv.innerHTML = lines.join('</div>');
        }
    }

    // Fonction pour mettre à jour les métriques d'URL et démarrer la mesure du temps de rendu
    function updateMetrics(isNavigationEvent = false) {
        const metricsDiv = document.getElementById('page-metrics-display');
        if (!metricsDiv) {
            displayPageMetrics();
            return;
        }

        try {
            // Analyser l'URL
            const urlInfo = parseURL(window.location.href);
            console.log('Informations URL analysées:', urlInfo);

            // Calculer le temps de chargement initial
            const { initialLoadTime, initialDOMLoadTime } = getInitialLoadTimes();

                            // Si c'est un événement de navigation, démarrer le chronomètre pour mesurer le temps de rendu
            if (isNavigationEvent) {
                navigationStartTime = performance.now();

                // Mettre à jour les informations d'URL immédiatement
                metricsDiv.innerHTML = `
                    <div>Domaine: ${urlInfo.domainInfo}</div>
                    <div>Page: ${urlInfo.pathInfo}</div>
                    <div>Paramètres: ${urlInfo.paramsInfo}</div>
                    <div>Temps: calcul en cours...</div>
                `;

                // Démarrer la détection de la fin du chargement
                detectContentLoadEnd();
            } else {
                // Mise à jour normale pour chargement initial
                metricsDiv.innerHTML = `
                    <div>Domaine: ${urlInfo.domainInfo}</div>
                    <div>Page: ${urlInfo.pathInfo}</div>
                    <div>Paramètres: ${urlInfo.paramsInfo}</div>
                    <div>Temps: ${initialLoadTime/1000}s </div>
                `;
            }

            console.log('Contenu du div de métriques mis à jour');
        } catch (e) {
            console.error('Erreur lors de la mise à jour des métriques:', e);
            metricsDiv.innerHTML = `<div>Erreur: ${e.message}</div>`;
        }
    }

    // Fonction principale pour afficher les métriques
    function displayPageMetrics() {
        console.log('Affichage initial des métriques');

        if (!document.body) {
            console.error('Le body n\'existe pas encore, nouvelle tentative après délai');
            setTimeout(displayPageMetrics, 100);
            return;
        }

        // Éviter les doublons
        if (document.getElementById('page-metrics-display')) {
            updateMetrics();
            return;
        }

        const metricsDiv = createMetricsDiv();
        document.body.appendChild(metricsDiv);
        console.log('Div de métriques ajouté au body');

        // Initialiser avec les valeurs actuelles
        updateMetrics();

        // Stocker le chemin+hash actuel pour détecter les changements
        lastPathAndHash = window.location.pathname + window.location.hash;
    }

    // Surveiller les clics pour mesurer le temps de réponse
    function setupClickListener() {
        document.addEventListener('click', function(e) {
            console.log('Clic détecté');
            clickTime = performance.now();

            // Vérifier si le clic est sur un lien ou un élément de navigation
            let target = e.target;
            let isNavigationElement = false;

            // Remonter jusqu'à 5 niveaux pour trouver un élément de navigation potentiel
            for (let i = 0; i < 5 && target; i++) {
                if (target.tagName === 'A' ||
                    target.tagName === 'BUTTON' ||
                    target.getAttribute('role') === 'button' ||
                    target.getAttribute('role') === 'link' ||
                    target.getAttribute('role') === 'tab' ||
                    target.getAttribute('role') === 'menuitem') {
                    isNavigationElement = true;
                    break;
                }
                target = target.parentElement;
            }

            // Si c'est un élément de navigation, attendre un changement d'URL
            if (isNavigationElement) {
                setTimeout(function() {
                    const currentPathAndHash = window.location.pathname + window.location.hash;
                    if (currentPathAndHash !== lastPathAndHash) {
                        console.log('Changement d\'URL détecté après clic sur élément de navigation');
                        lastPathAndHash = currentPathAndHash;
                        updateMetrics(true); // true indique un événement de navigation
                        navigationStartTime = clickTime; // Utiliser le moment du clic comme début de navigation
                    }
                }, 50);
            }
        }, true);
    }

    // Surveiller les changements de hash pour les SPA
    function setupHashChangeListener() {
        window.addEventListener('hashchange', function() {
            console.log('Événement hashchange détecté');
            const currentPathAndHash = window.location.pathname + window.location.hash;
            if (currentPathAndHash !== lastPathAndHash) {
                lastPathAndHash = currentPathAndHash;
                updateMetrics(true);
            }
        });
    }

    // Surveiller l'historique pour les SPA (pushState/replaceState)
    function setupHistoryListener() {
        // Stocker les fonctions originales
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        // Remplacer pushState
        history.pushState = function() {
            originalPushState.apply(this, arguments);
            console.log('pushState détecté');
            const currentPathAndHash = window.location.pathname + window.location.hash;
            if (currentPathAndHash !== lastPathAndHash) {
                lastPathAndHash = currentPathAndHash;
                updateMetrics(true);
            }
        };

        // Remplacer replaceState
        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            console.log('replaceState détecté');
            const currentPathAndHash = window.location.pathname + window.location.hash;
            if (currentPathAndHash !== lastPathAndHash) {
                lastPathAndHash = currentPathAndHash;
                updateMetrics(true);
            }
        };

        // Écouter aussi l'événement popstate (navigation avant/arrière)
        window.addEventListener('popstate', function() {
            console.log('Événement popstate détecté');
            const currentPathAndHash = window.location.pathname + window.location.hash;
            if (currentPathAndHash !== lastPathAndHash) {
                lastPathAndHash = currentPathAndHash;
                updateMetrics(true);
            }
        });
    }

    // Initialiser le script
    function init() {
        // Obtenir le temps de chargement initial
        getInitialLoadTimes();

        // Afficher les métriques
        displayPageMetrics();

        // Configurer les écouteurs d'événements
        setupClickListener();
        setupHashChangeListener();
        setupHistoryListener();

        // Surveiller les changements d'URL toutes les secondes (filet de sécurité)
        setInterval(function() {
            const currentPathAndHash = window.location.pathname + window.location.hash;
            if (currentPathAndHash !== lastPathAndHash) {
                console.log('Changement d\'URL détecté par intervalles');
                lastPathAndHash = currentPathAndHash;
                updateMetrics(true);
            }
        }, 1000);
    }

    // Démarrer le script
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 100);
        });
    } else {
        setTimeout(init, 100);
    }

    // S'assurer que le script s'exécute même si load est déjà passé
    window.addEventListener('load', function() {
        if (!document.getElementById('page-metrics-display')) {
            init();
        }
    });

    // Dernière tentative
    setTimeout(function() {
        if (!document.getElementById('page-metrics-display')) {
            init();
        }
    }, 2000);
})();
